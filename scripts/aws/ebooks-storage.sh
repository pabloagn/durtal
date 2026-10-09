#!/bin/bash
# SLN-569: scoped eBook protection in the EXISTING durtal bucket.
# plan renders exact merged documents; apply writes only those three documents.
# Existing media settings, managed IAM policies and CloudFront are untouched.
set -euo pipefail
mode=${1:-}; [ $# -gt 0 ] && shift
case "$mode" in plan|apply) ;; *) echo "Usage: $0 plan|apply --expected-account ID --admin-arn ARN [--output-dir DIR] [--yes-from-joris]" >&2; exit 2;; esac
output_dir=""
yes=0
prefix=""
app_user=durtal-app
admin_arn=""
expected_account=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expected-account) expected_account=${2:?}; shift 2;;
    --admin-arn) admin_arn=${2:?}; shift 2;;
    --output-dir) output_dir=${2:?}; shift 2;;
    --yes-from-joris) yes=1; shift;;
    --prefix) prefix=${2-}; shift 2;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
done
if [ "$mode" = apply ] && [ "$yes" != 1 ]; then
  echo "apply requires --yes-from-joris and the reviewed rendered plan" >&2; exit 2
fi
[[ -z "$prefix" || "$prefix" =~ ^([a-z0-9][a-z0-9._-]*/)+$ ]] || { echo "Invalid legacy prefix" >&2; exit 2; }
[[ "$expected_account" =~ ^[0-9]{12}$ ]] || { echo "--expected-account must be the reviewed personal account ID" >&2; exit 2; }
[[ "$admin_arn" == "arn:aws:iam::${expected_account}:role/"* ]] || { echo "--admin-arn must be the reviewed role in the expected account" >&2; exit 2; }
command -v aws >/dev/null || { echo "The AWS CLI v2 is needed" >&2; exit 3; }
# Explicit standard profile files; discard ambient credentials, endpoints and profile overrides.
for name in ${!AWS_@}; do unset "$name"; done
export AWS_CONFIG_FILE="$HOME/.aws/config" AWS_SHARED_CREDENTIALS_FILE="$HOME/.aws/credentials" AWS_EC2_METADATA_DISABLED=true
aws_personal() { aws "$@" --profile durtal-personal --region eu-north-1 --no-cli-pager; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
aws_personal sts get-caller-identity --output json > "$work/identity.json"
python3 - "$work/identity.json" "$mode" "$admin_arn" "$expected_account" <<'PYCODE'
import json,sys
identity=json.load(open(sys.argv[1]))
if identity.get('Account') != sys.argv[4]: sys.exit('Personal account guard failed. Nothing written.')
if sys.argv[2] == 'apply':
    expected=sys.argv[3]
    arn=identity.get('Arn','')
    assumed='arn:aws:sts::'+sys.argv[4]+':assumed-role/'+expected.rsplit('/',1)[1]+'/'
    if arn != expected and not arn.startswith(assumed): sys.exit('Exact personal admin principal guard failed. Nothing written.')
PYCODE
location=$(aws_personal s3api get-bucket-location --bucket durtal --expected-bucket-owner "$expected_account" --query LocationConstraint --output text)
[ "$location" = eu-north-1 ] || { echo "Bucket region guard failed. Nothing written." >&2; exit 1; }
read_document() {
  local target=$1 absent=$2; shift 2
  if aws_personal "$@" --output json > "$work/$target" 2> "$work/error"; then return; fi
  if grep -q "$absent" "$work/error"; then echo '{}' > "$work/$target"; else echo "Cannot read $target; refusing to infer missing infrastructure" >&2; exit 1; fi
}
read_document bucket-policy.before.json NoSuchBucketPolicy s3api get-bucket-policy --bucket durtal --expected-bucket-owner "$expected_account"
read_document lifecycle.before.json NoSuchLifecycleConfiguration s3api get-bucket-lifecycle-configuration --bucket durtal --expected-bucket-owner "$expected_account"
read_document app-user-policy.before.json NoSuchEntity iam get-user-policy --user-name "$app_user" --policy-name durtal-ebooks-multipart
root=$(cd "$(dirname "$0")/../.." && pwd)
python3 - "$root/infra/aws/ebooks" "$work" "$prefix" "$admin_arn" <<'PYCODE'
import json,sys,pathlib
source,work,prefix,admin=sys.argv[1:]
work=pathlib.Path(work)
def render(name):
    text=(pathlib.Path(source)/name).read_text()
    for key,value in {'BUCKET':'durtal','PREFIX':prefix,'ADMIN_ARN':admin}.items(): text=text.replace('__'+key+'__',json.dumps(value)[1:-1])
    return json.loads(text)
def save(name,doc): (work/name).write_text(json.dumps(doc,indent=2)+'\n')
def merge(have,want,field,id):
    desired=want[field]; ids={x[id] for x in desired}
    return {**have,**want,field:[x for x in have.get(field,[]) if x.get(id) not in ids]+desired}
old=json.load(open(work/'bucket-policy.before.json'))
old=json.loads(old.get('Policy','{}'))
save('bucket-policy.before.json',old)
save('bucket-policy.json',merge(old,render('bucket-policy.json'),'Statement','Sid'))
old=json.load(open(work/'lifecycle.before.json')); old={k:v for k,v in old.items() if k=='Rules'}
save('lifecycle.before.json',old)
save('lifecycle.json',merge(old,render('lifecycle.json'),'Rules','ID'))
old=json.load(open(work/'app-user-policy.before.json')).get('PolicyDocument',{})
save('app-user-policy.before.json',old)
save('app-user-policy.json',merge(old,render('app-user-policy.json'),'Statement','Sid'))
PYCODE
if [ -n "$output_dir" ]; then
  mkdir -p "$output_dir"
  cp "$work/"*.json "$output_dir/"
fi
for name in bucket-policy lifecycle app-user-policy; do
  echo "$name:"
  diff -u "$work/$name.before.json" "$work/$name.json" || [ $? = 1 ]
done
if [ "$mode" = plan ]; then
  echo "Read-only plan. Bucket-wide settings, images, managed IAM policies and CloudFront unchanged."
  exit 0
fi
if ! cmp -s "$work/bucket-policy.before.json" "$work/bucket-policy.json"; then
  aws_personal s3api put-bucket-policy --bucket durtal --expected-bucket-owner "$expected_account" --policy "file://$work/bucket-policy.json"
fi
if ! cmp -s "$work/lifecycle.before.json" "$work/lifecycle.json"; then
  aws_personal s3api put-bucket-lifecycle-configuration --bucket durtal --expected-bucket-owner "$expected_account" --lifecycle-configuration "file://$work/lifecycle.json"
fi
if ! cmp -s "$work/app-user-policy.before.json" "$work/app-user-policy.json"; then
  aws_personal iam put-user-policy --user-name "$app_user" --policy-name durtal-ebooks-multipart --policy-document "file://$work/app-user-policy.json"
fi
