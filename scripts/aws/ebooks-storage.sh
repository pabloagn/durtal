#!/bin/bash
# The e-book bucket's AWS setup (SLN-491), as code that plans before it applies.
#
#   scripts/aws/ebooks-storage.sh plan  [options]
#   scripts/aws/ebooks-storage.sh apply --yes-from-joris --app-user NAME --alert-email ADDRESS [options]
#
# plan runs only read-only AWS calls (get, list, describe, head) and prints
# what exists, what differs from infra/aws/ebooks/ and what apply would
# create or update. apply creates or updates exactly that, and only that,
# and is safe to run again:
#
#   - the private, versioned bucket (SSE-S3, public access blocked, objects
#     owned by the bucket), its lifecycle and its bucket policy (CloudFront
#     reads through Origin Access Control; only the admin deletes a book file
#     or changes versioning, lifecycle or the policy);
#   - the CloudFront distribution (HTTP/2 and HTTP/3, all edge locations, the
#     default *.cloudfront.net name), its cache and response headers policies,
#     its Origin Access Control, and the trusted key group with its public key;
#   - the app user's inline policy (read, write and list; delete only staging/);
#   - an AWS Budgets alarm at 5 USD a month on the account.
#
# The key group's private key is made here, with openssl, and written only to
# the env file (default .env.local) as EBOOK_CDN_PRIVATE_KEY (a base64 PEM).
# It is never printed. apply ends by printing the other values for the app's
# environment. No account id or secret is checked in: the documents in
# infra/aws/ebooks/ carry __PLACEHOLDERS__ filled in at run time.
#
# Options:
#   --bucket NAME        default durtal-ebooks
#   --prefix PREFIX      default empty; folders ending in a slash (ebooks/)
#   --region REGION      default eu-north-1
#   --admin-arn ARN      the one principal that may delete book files and
#                        change protection; default: the caller (its role, for
#                        an assumed role). apply must run as that principal.
#   --app-user NAME      the IAM user whose keys the app uses
#   --alert-email ADDR   where the budget alarm writes
#   --env-file FILE      default .env.local in the repository
#
# Needs the AWS CLI v2, python3 and (for apply) openssl.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
docs="$root/infra/aws/ebooks"

usage() {
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

mode=${1:-}
[ $# -gt 0 ] && shift
bucket=durtal-ebooks
prefix=""
region=eu-north-1
admin_arn=""
app_user=""
alert_email=""
env_file="$root/.env.local"
yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    --bucket) bucket=${2:?}; shift 2 ;;
    --prefix) prefix=${2-}; shift 2 ;;
    --region) region=${2:?}; shift 2 ;;
    --admin-arn) admin_arn=${2:?}; shift 2 ;;
    --app-user) app_user=${2:?}; shift 2 ;;
    --alert-email) alert_email=${2:?}; shift 2 ;;
    --env-file) env_file=${2:?}; shift 2 ;;
    --yes-from-joris) yes=1; shift ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done
case "$mode" in plan | apply) ;; *) usage ;; esac

if [ "$mode" = apply ] && [ "$yes" != 1 ]; then
  echo "apply changes AWS. It runs only with --yes-from-joris, after Joris's own yes; run plan first." >&2
  exit 2
fi
if [ "$mode" = apply ] && { [ -z "$app_user" ] || [ -z "$alert_email" ]; }; then
  echo "apply needs --app-user NAME (the app's IAM user) and --alert-email ADDRESS (the budget alarm)." >&2
  exit 2
fi
if ! command -v aws >/dev/null 2>&1; then
  echo "The AWS CLI v2 is needed: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" >&2
  exit 3
fi
if ! aws --version 2>&1 | grep -q '^aws-cli/2\.'; then
  echo "The AWS CLI must be version 2 (found: $(aws --version 2>&1 | head -1))." >&2
  exit 3
fi
command -v python3 >/dev/null 2>&1 || { echo "python3 is needed." >&2; exit 3; }
if [ "$mode" = apply ] && ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is needed to make the key group's key." >&2
  exit 3
fi
[[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || { echo "Not a bucket name: $bucket" >&2; exit 2; }
[[ -z "$prefix" || "$prefix" =~ ^([a-z0-9][a-z0-9._-]*/)+$ ]] || { echo "The prefix must be folder names ending in a slash, such as ebooks/" >&2; exit 2; }
[[ "$region" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]$ ]] || { echo "Not a region: $region" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077

# ── JSON, with python3 ──────────────────────────────────────────────────────

# json render FILE: the document with each __NAME__ replaced by $R_NAME
# json covers WANT HAVE: exit 0 when every value WANT sets is in HAVE
# json merge HAVE WANT: HAVE with WANT's top-level keys laid over it
# json field JSON KEY...: one value (empty when absent)
json() {
  python3 - "$@" <<'PY'
import json, os, re, sys

cmd, args = sys.argv[1], sys.argv[2:]

def load(text):
    return json.loads(text) if text.strip() else None

if cmd == "render":
    text = open(args[0]).read()
    def value(match):
        name = "R_" + match.group(1)
        if name not in os.environ:
            sys.exit(f"render: no value for {match.group(0)} in {args[0]}")
        return json.dumps(os.environ[name])[1:-1]
    print(json.dumps(json.loads(re.sub(r"__([A-Z_]+)__", value, text)), separators=(",", ":")))
elif cmd == "covers":
    def covers(want, have):
        if isinstance(want, dict):
            return isinstance(have, dict) and all(covers(v, have.get(k)) for k, v in want.items())
        if isinstance(want, list):
            if not isinstance(have, list) or len(want) != len(have):
                return False
            free = list(have)
            for item in want:
                match = next((h for h in free if covers(item, h)), None)
                if match is None:
                    return False
                free.remove(match)
            return True
        return want == have
    sys.exit(0 if covers(load(args[0]), load(args[1])) else 1)
elif cmd == "merge":
    have, want = load(args[0]) or {}, load(args[1])
    have.update({k: v for k, v in want.items() if k != "CallerReference"})
    print(json.dumps(have, separators=(",", ":")))
elif cmd == "field":
    value = load(args[0])
    for key in args[1:]:
        value = value.get(key) if isinstance(value, dict) else None
    print("" if value is None else value if isinstance(value, str) else json.dumps(value))
PY
}

render() {
  R_BUCKET=$bucket R_PREFIX=$prefix R_REGION=$region R_ADMIN_ARN=${admin_arn:-} \
    R_DISTRIBUTION_ARN=${distribution_arn:-__unknown__} R_OAC_ID=${oac_id:-__unknown__} \
    R_CACHE_POLICY_ID=${cache_policy_id:-__unknown__} R_RESPONSE_HEADERS_POLICY_ID=${headers_policy_id:-__unknown__} \
    R_KEY_GROUP_ID=${key_group_id:-__unknown__} R_ALERT_EMAIL=${alert_email:-__unknown__} \
    json render "$docs/$1"
}

# ── Plan output ─────────────────────────────────────────────────────────────

changes=0
state() { # state NAME ok|differs|missing|skipped [DETAIL]
  local label
  case "$2" in
    ok) label="ok" ;;
    differs) label="differs: apply updates it"; changes=$((changes + 1)) ;;
    missing) label="missing: apply creates it"; changes=$((changes + 1)) ;;
    skipped) label="not checked" ;;
  esac
  printf '  %-34s %s%s\n' "$1" "$label" "${3:+ ($3)}"
}

# A read-only AWS call: its output, or nothing when it fails (absent, or not allowed)
read_aws() { aws "$@" --output json 2>/dev/null || true; }

# ── What exists ─────────────────────────────────────────────────────────────

identity=$(aws sts get-caller-identity --output json)
account=$(json field "$identity" Account)
caller=$(json field "$identity" Arn)
if [ -z "$admin_arn" ]; then
  # An assumed role's sessions share the role: the policy names the role
  if [[ "$caller" =~ ^arn:aws:sts::([0-9]+):assumed-role/([^/]+)/ ]]; then
    admin_arn="arn:aws:iam::${BASH_REMATCH[1]}:role/${BASH_REMATCH[2]}"
  else
    admin_arn=$caller
  fi
fi

discover() {
  bucket_exists=0
  aws s3api head-bucket --bucket "$bucket" >/dev/null 2>&1 && bucket_exists=1
  oac=$(read_aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='durtal-ebooks'] | [0]")
  oac_id=$(json field "$oac" Id)
  key_group=$(read_aws cloudfront list-key-groups --query "KeyGroupList.Items[?KeyGroup.KeyGroupConfig.Name=='durtal-ebooks'] | [0].KeyGroup")
  key_group_id=$(json field "$key_group" Id)
  cache_policy=$(read_aws cloudfront list-cache-policies --type custom --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='durtal-ebooks-immutable'] | [0].CachePolicy")
  cache_policy_id=$(json field "$cache_policy" Id)
  headers_policy=$(read_aws cloudfront list-response-headers-policies --type custom --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='durtal-ebooks-cors'] | [0].ResponseHeadersPolicy")
  headers_policy_id=$(json field "$headers_policy" Id)
  distribution_id=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='durtal-ebooks'] | [0].Id" --output text 2>/dev/null || true)
  [ "$distribution_id" = None ] && distribution_id=""
  distribution_arn=""
  [ -n "$distribution_id" ] && distribution_arn="arn:aws:cloudfront::${account}:distribution/${distribution_id}"
  return 0
}

# Whether the env file holds a private key (its value is never read into this shell)
env_has_key() { [ -f "$env_file" ] && grep -Eq '^EBOOK_CDN_PRIVATE_KEY=.+' "$env_file"; }

# The public key (PEM) of the env file's private key, or nothing
env_public_key() {
  env_has_key || return 0
  python3 - "$env_file" <<'PY' | openssl rsa -pubout 2>/dev/null || true
import base64, sys
for line in open(sys.argv[1]):
    if line.startswith("EBOOK_CDN_PRIVATE_KEY="):
        sys.stdout.write(base64.b64decode(line.split("=", 1)[1].strip()).decode())
        break
PY
}

# The id of the CloudFront public key that matches the env file's key, or nothing
matching_public_key_id() {
  local pem
  pem=$(env_public_key)
  [ -n "$pem" ] || return 0
  local keys
  keys=$(read_aws cloudfront list-public-keys --query "PublicKeyList.Items[?starts_with(Name, 'durtal-ebooks-')]")
  PEM=$pem python3 - "$keys" <<'PY'
import json, os, sys
keys = json.loads(sys.argv[1] or "[]") or []
norm = lambda text: "".join(text.split())
for key in keys:
    if norm(key.get("EncodedKey", "")) == norm(os.environ["PEM"]):
        print(key["Id"])
        break
PY
}

check_bucket() {
  echo "Bucket $bucket ($region)"
  if [ "$bucket_exists" != 1 ]; then
    state "bucket" missing
    for part in "versioning" "encryption (SSE-S3)" "public access blocked" "objects owned by the bucket" "lifecycle" "bucket policy"; do state "$part" missing; done
    return 0
  fi
  local location
  location=$(aws s3api get-bucket-location --bucket "$bucket" --query LocationConstraint --output text 2>/dev/null || true)
  [ "$location" = None ] && location=us-east-1
  if [ "$location" = "$region" ]; then state "bucket" ok; else state "bucket" skipped "it is in $location, not $region: apply stops"; fi
  [ "$(aws s3api get-bucket-versioning --bucket "$bucket" --query Status --output text 2>/dev/null || true)" = Enabled ] && state "versioning" ok || state "versioning" differs
  [ "$(aws s3api get-bucket-encryption --bucket "$bucket" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text 2>/dev/null || true)" = AES256 ] \
    && state "encryption (SSE-S3)" ok || state "encryption (SSE-S3)" differs
  json covers '{"BlockPublicAcls":true,"IgnorePublicAcls":true,"BlockPublicPolicy":true,"RestrictPublicBuckets":true}' \
    "$(read_aws s3api get-public-access-block --bucket "$bucket" --query PublicAccessBlockConfiguration)" \
    && state "public access blocked" ok || state "public access blocked" differs
  [ "$(aws s3api get-bucket-ownership-controls --bucket "$bucket" --query 'OwnershipControls.Rules[0].ObjectOwnership' --output text 2>/dev/null || true)" = BucketOwnerEnforced ] \
    && state "objects owned by the bucket" ok || state "objects owned by the bucket" differs
  local tiering
  tiering=$(read_aws s3api list-bucket-intelligent-tiering-configurations --bucket "$bucket" --query 'IntelligentTieringConfigurationList[].Tierings[]')
  if [ -z "$tiering" ] || [ "$tiering" = "[]" ] || [ "$tiering" = null ]; then state "no archive tiers" ok
  else state "no archive tiers" skipped "an archive tier is configured: remove it by hand, it breaks instant open"; fi
  json covers "$(render lifecycle.json)" "$(read_aws s3api get-bucket-lifecycle-configuration --bucket "$bucket")" \
    && state "lifecycle" ok || state "lifecycle" differs
  if [ -z "$distribution_arn" ]; then
    state "bucket policy" missing "set once the distribution exists"
  else
    json covers "$(render bucket-policy.json)" "$(aws s3api get-bucket-policy --bucket "$bucket" --query Policy --output text 2>/dev/null || true)" \
      && state "bucket policy" ok || state "bucket policy" differs
  fi
}

check_cloudfront() {
  echo "CloudFront"
  [ -n "$oac_id" ] && state "origin access control" ok || state "origin access control" missing
  local key_id
  key_id=$(matching_public_key_id)
  if [ -n "$key_id" ]; then state "public key" ok "the env file's key"
  elif env_has_key; then state "public key" missing "the env file's key is not uploaded"
  else state "public key" missing "made locally; private key to $(basename "$env_file")"; fi
  if [ -z "$key_group_id" ]; then state "trusted key group" missing
  elif [ -n "$key_id" ] && json covers "[\"$key_id\"]" "$(json field "$key_group" KeyGroupConfig Items)"; then state "trusted key group" ok
  elif [ -n "$key_id" ] && python3 -c 'import json,sys; sys.exit(0 if sys.argv[1] in json.loads(sys.argv[2] or "[]") else 1)' "$key_id" "$(json field "$key_group" KeyGroupConfig Items)"; then state "trusted key group" ok "also trusts older keys"
  else state "trusted key group" differs "the key is added"; fi
  if [ -z "$cache_policy_id" ]; then state "cache policy" missing
  else json covers "$(render cache-policy.json)" "$(json field "$cache_policy" CachePolicyConfig)" && state "cache policy" ok || state "cache policy" differs; fi
  if [ -z "$headers_policy_id" ]; then state "response headers policy (CORS)" missing
  else json covers "$(render response-headers-policy.json)" "$(json field "$headers_policy" ResponseHeadersPolicyConfig)" \
    && state "response headers policy (CORS)" ok || state "response headers policy (CORS)" differs; fi
  if [ -z "$distribution_id" ]; then state "distribution" missing
  else
    local want have
    want=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); d.pop("CallerReference"); print(json.dumps(d))' "$(render distribution.json)")
    have=$(read_aws cloudfront get-distribution-config --id "$distribution_id" --query DistributionConfig)
    json covers "$want" "$have" && state "distribution" ok "$distribution_id" || state "distribution" differs "$distribution_id"
  fi
}

check_access() {
  echo "Access and cost"
  if [ -z "$app_user" ]; then state "app user's policy" skipped "pass --app-user NAME"
  else
    json covers "$(render app-user-policy.json)" "$(read_aws iam get-user-policy --user-name "$app_user" --policy-name durtal-ebooks --query PolicyDocument)" \
      && state "app user's policy" ok || state "app user's policy" missing
  fi
  local budget
  budget=$(read_aws budgets describe-budget --account-id "$account" --budget-name durtal-monthly --query Budget)
  if [ -z "$budget" ] || [ "$budget" = null ]; then state "budget alarm (5 USD a month)" missing
  else
    json covers "$(python3 -c 'import json,sys; d=json.loads(open(sys.argv[1]).read()); print(json.dumps({"BudgetLimit": {"Unit": "USD"}, "TimeUnit": d["TimeUnit"], "BudgetType": d["BudgetType"]}))' "$docs/budget.json")" "$budget" \
      && [ "$(python3 -c 'import json,sys; print(float(json.loads(sys.argv[1])["BudgetLimit"]["Amount"]))' "$budget")" = 5.0 ] \
      && state "budget alarm (5 USD a month)" ok || state "budget alarm (5 USD a month)" differs
  fi
}

plan() {
  discover
  echo "Account $account, as $caller (admin: $admin_arn)"
  check_bucket
  check_cloudfront
  check_access
  echo
  if [ "$changes" = 0 ]; then echo "No difference from infra/aws/ebooks/."
  else echo "$changes to create or update. apply does exactly this, with --yes-from-joris."; fi
}

if [ "$mode" = plan ]; then
  plan
  exit 0
fi

# ── Apply ───────────────────────────────────────────────────────────────────

say() { printf '[ebooks-storage] %s\n' "$*"; }
doc() { render "$1" > "$work/$1"; echo "file://$work/$1"; }

discover

if [ "$bucket_exists" != 1 ]; then
  say "creating the bucket $bucket in $region"
  if [ "$region" = us-east-1 ]; then aws s3api create-bucket --bucket "$bucket" --region "$region" >/dev/null
  else aws s3api create-bucket --bucket "$bucket" --region "$region" --create-bucket-configuration "LocationConstraint=$region" >/dev/null; fi
else
  location=$(aws s3api get-bucket-location --bucket "$bucket" --query LocationConstraint --output text)
  [ "$location" = None ] && location=us-east-1
  [ "$location" = "$region" ] || { echo "The bucket $bucket is in $location, not $region: nothing was changed." >&2; exit 1; }
fi
aws s3api put-public-access-block --bucket "$bucket" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls --bucket "$bucket" --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-encryption --bucket "$bucket" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration "$(doc lifecycle.json)" >/dev/null
say "bucket: versioned, encrypted, private, lifecycle set"

if [ -z "$oac_id" ]; then
  oac_id=$(aws cloudfront create-origin-access-control --origin-access-control-config "$(doc origin-access-control.json)" \
    --query OriginAccessControl.Id --output text)
  say "origin access control $oac_id created"
fi

key_id=$(matching_public_key_id)
if [ -z "$key_id" ]; then
  if env_has_key; then
    echo "The env file already holds an EBOOK_CDN_PRIVATE_KEY that CloudFront does not know. Remove that line (or pass another --env-file) to make a new key." >&2
    exit 1
  fi
  stamp=$(date -u +%Y%m%d%H%M%S)
  openssl genrsa -out "$work/private.pem" 2048 2>/dev/null
  openssl rsa -in "$work/private.pem" -pubout -out "$work/public.pem" 2>/dev/null
  python3 - "$work/public.pem" "$stamp" > "$work/public-key.json" <<'PY'
import json, sys
print(json.dumps({"CallerReference": f"durtal-ebooks-{sys.argv[2]}", "Name": f"durtal-ebooks-{sys.argv[2]}",
                  "EncodedKey": open(sys.argv[1]).read(), "Comment": "Durtal e-books: signs CloudFront URLs"}))
PY
  key_id=$(aws cloudfront create-public-key --public-key-config "file://$work/public-key.json" --query PublicKey.Id --output text)
  # The private key goes to the env file only, as one base64 line; never to the screen
  python3 - "$env_file" "$work/private.pem" <<'PY'
import base64, os, sys
path, pem = sys.argv[1], open(sys.argv[2], "rb").read()
line = "EBOOK_CDN_PRIVATE_KEY=" + base64.b64encode(pem).decode() + "\n"
lines = open(path).readlines() if os.path.exists(path) else []
lines = [l for l in lines if not l.startswith("EBOOK_CDN_PRIVATE_KEY=")]
if lines and not lines[-1].endswith("\n"):
    lines[-1] += "\n"
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as out:
    out.writelines(lines + [line])
PY
  rm -f "$work/private.pem"
  say "public key $key_id created; its private key is in $env_file"
fi

if [ -z "$key_group_id" ]; then
  key_group_id=$(aws cloudfront create-key-group \
    --key-group-config "{\"Name\":\"durtal-ebooks\",\"Items\":[\"$key_id\"],\"Comment\":\"Durtal e-books\"}" \
    --query KeyGroup.Id --output text)
  say "key group $key_group_id created"
else
  items=$(json field "$key_group" KeyGroupConfig Items)
  if ! python3 -c 'import json,sys; sys.exit(0 if sys.argv[1] in json.loads(sys.argv[2] or "[]") else 1)' "$key_id" "$items"; then
    etag=$(aws cloudfront get-key-group --id "$key_group_id" --query ETag --output text)
    config=$(python3 -c 'import json,sys; c=json.loads(sys.argv[1]); c["Items"]=c.get("Items",[])+[sys.argv[2]]; print(json.dumps(c))' \
      "$(json field "$key_group" KeyGroupConfig)" "$key_id")
    aws cloudfront update-key-group --id "$key_group_id" --if-match "$etag" --key-group-config "$config" >/dev/null
    say "key $key_id added to the key group"
  fi
fi

if [ -z "$cache_policy_id" ]; then
  cache_policy_id=$(aws cloudfront create-cache-policy --cache-policy-config "$(doc cache-policy.json)" --query CachePolicy.Id --output text)
  say "cache policy $cache_policy_id created"
elif ! json covers "$(render cache-policy.json)" "$(json field "$cache_policy" CachePolicyConfig)"; then
  etag=$(aws cloudfront get-cache-policy --id "$cache_policy_id" --query ETag --output text)
  aws cloudfront update-cache-policy --id "$cache_policy_id" --if-match "$etag" --cache-policy-config "$(doc cache-policy.json)" >/dev/null
  say "cache policy updated"
fi

if [ -z "$headers_policy_id" ]; then
  headers_policy_id=$(aws cloudfront create-response-headers-policy --response-headers-policy-config "$(doc response-headers-policy.json)" \
    --query ResponseHeadersPolicy.Id --output text)
  say "response headers policy $headers_policy_id created"
elif ! json covers "$(render response-headers-policy.json)" "$(json field "$headers_policy" ResponseHeadersPolicyConfig)"; then
  etag=$(aws cloudfront get-response-headers-policy --id "$headers_policy_id" --query ETag --output text)
  aws cloudfront update-response-headers-policy --id "$headers_policy_id" --if-match "$etag" \
    --response-headers-policy-config "$(doc response-headers-policy.json)" >/dev/null
  say "response headers policy updated"
fi

if [ -z "$distribution_id" ]; then
  distribution_id=$(aws cloudfront create-distribution --distribution-config "$(doc distribution.json)" --query Distribution.Id --output text)
  say "distribution $distribution_id created (it takes a few minutes to deploy)"
else
  current=$(aws cloudfront get-distribution-config --id "$distribution_id" --output json)
  want=$(render distribution.json)
  if ! json covers "$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); d.pop("CallerReference"); print(json.dumps(d))' "$want")" "$(json field "$current" DistributionConfig)"; then
    json merge "$(json field "$current" DistributionConfig)" "$want" > "$work/distribution-update.json"
    aws cloudfront update-distribution --id "$distribution_id" --if-match "$(json field "$current" ETag)" \
      --distribution-config "file://$work/distribution-update.json" >/dev/null
    say "distribution $distribution_id updated"
  fi
fi
distribution_arn="arn:aws:cloudfront::${account}:distribution/${distribution_id}"
domain=$(aws cloudfront get-distribution --id "$distribution_id" --query Distribution.DomainName --output text)

aws s3api put-bucket-policy --bucket "$bucket" --policy "$(doc bucket-policy.json)"
say "bucket policy set: CloudFront reads; only $admin_arn deletes book files or changes protection"

aws iam put-user-policy --user-name "$app_user" --policy-name durtal-ebooks --policy-document "$(doc app-user-policy.json)"
say "the app user $app_user may read, write and list e-books, and delete only staged uploads"

budget=$(read_aws budgets describe-budget --account-id "$account" --budget-name durtal-monthly --query Budget)
if [ -z "$budget" ] || [ "$budget" = null ]; then
  aws budgets create-budget --account-id "$account" --budget "$(doc budget.json)" \
    --notifications-with-subscribers "$(doc budget-notifications.json)"
  say "budget alarm created: 5 USD a month, mail at 80% spent and 100% forecast"
else
  aws budgets update-budget --account-id "$account" --new-budget "$(doc budget.json)"
  say "budget checked: 5 USD a month"
fi

cat <<EOF

Put these in the app's environment (the private key is already in $env_file):

EBOOKS_BUCKET=$bucket
EBOOKS_PREFIX=$prefix
EBOOKS_REGION=$region
EBOOK_DELIVERY=cloudfront
EBOOK_CDN_URL=https://$domain
EBOOK_CDN_KEY_PAIR_ID=$key_id
EOF
