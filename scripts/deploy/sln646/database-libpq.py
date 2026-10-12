# Spec-driven root adaptation. No action until all placeholders and pins resolve.
import json, hashlib, os, sys, stat, re, subprocess, time
from pathlib import Path
os.umask(0o077); sys.dont_write_bytecode = True
assert len(sys.argv) >= 3
spec_path = Path(sys.argv[1]); spec_bytes = spec_path.read_bytes()
assert re.fullmatch('[a-f0-9]{64}', sys.argv[2]) and hashlib.sha256(spec_bytes).hexdigest() == sys.argv[2]
info = spec_path.lstat()
assert stat.S_ISREG(info.st_mode) and not spec_path.is_symlink() and info.st_uid == os.getuid() and not info.st_mode & 0o077
assert not any(marker in spec_bytes for marker in (b'FINAL_COMMIT', b'FINAL_RELEASE', b'FINAL_TREE', b'REQUIRED_', b'${'))
spec = json.loads(spec_bytes)
def digest_file(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''): h.update(block)
    return h.hexdigest()
def check_pins(value):
    if isinstance(value, dict):
        if {'path', 'bytes', 'sha256'} <= value.keys():
            p = Path(value['path']); assert p.stat().st_size == value['bytes'] and digest_file(p) == value['sha256']
        for child in value.values(): check_pins(child)
    elif isinstance(value, list):
        for child in value: check_pins(child)
check_pins(spec)
def check_source():
    source = Path(spec['source']['path'])
    assert source == Path('/Users/pabloaguirre/.codex-personal/worktrees/reader-r15-main-integration/durtal')
    for argv, expected in ((['rev-parse','HEAD'], spec['source']['commit']), (['rev-parse','HEAD^{tree}'], spec['source']['tree']), (['status','--porcelain'], '')):
        result = subprocess.run(['/usr/bin/git','-C',str(source),*argv], capture_output=True, timeout=15, check=True)
        assert result.stdout.decode().strip() == expected
    return source
check_source()
assert spec['account'] == '608240934043' and spec['profile'] == 'durtal-personal'

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.parse import parse_qsl, unquote, urlparse

os.umask(0o077)
out = Path(spec['output_dir']); assert out.parent == Path('/private/tmp') and not out.exists()
out.mkdir(mode=0o700)
config_path = Path(spec['current_config']['path'])
assert hashlib.sha256(config_path.read_bytes()).hexdigest() == spec['current_config']['sha256']
config = json.loads(config_path.read_bytes())
release = Path(config['release'])
manifest = json.loads((release / 'release.json').read_bytes())
assert manifest['commit'] == '23ac237b9df3b640276ecefa5d749213cd564ad4'
for name, expected in manifest['deploymentToolFiles'].items():
    assert hashlib.sha256((release / 'deploy' / name).read_bytes()).hexdigest() == expected
for tool in ('node', 'aws'):
    assert hashlib.sha256(Path(config[tool]['path']).read_bytes()).hexdigest() == config[tool]['sha256']
sys.path.insert(0, str(release / 'deploy'))
import phone_secrets

values = phone_secrets.runtime_environment(
    ['DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    Path('/Users/pabloaguirre/personal/durtal/.env.local'),
    config['node']['path'], config['aws'])
uri = urlparse(values['DATABASE_URL'])
assert uri.scheme in ('postgres', 'postgresql') and uri.hostname and uri.username
assert not uri.fragment and uri.path.startswith('/')
options = dict(parse_qsl(uri.query, keep_blank_values=True, strict_parsing=True))
assert len(options) == len(parse_qsl(uri.query, keep_blank_values=True, strict_parsing=True))
allowed = {'sslmode': 'PGSSLMODE', 'channel_binding': 'PGCHANNELBINDING', 'options': 'PGOPTIONS', 'connect_timeout': 'PGCONNECT_TIMEOUT', 'application_name': 'PGAPPNAME'}
assert not set(options) - set(allowed), 'Unsupported connection parameters; no TLS or connection setting was dropped'
assert options.get('sslmode') in ('require', 'verify-ca', 'verify-full'), 'Encrypted owner connection required'
assert options.get('channel_binding') == 'require', 'Mandatory owner channel binding must be preserved'
base = spec['docker_environment']
env = {k: base[k] for k in ('DOCKER_HOST', 'DOCKER_CONFIG') if k in base}
env.update(PATH='/usr/bin:/bin:/opt/homebrew/bin', HOME='/Users/pabloaguirre', LANG='en_US.UTF-8',
           PGHOST=uri.hostname, PGPORT=str(uri.port or 5432), PGDATABASE=unquote(uri.path[1:]),
           PGUSER=unquote(uri.username), PGPASSWORD=unquote(uri.password or ''), PGCONNECT_TIMEOUT='10')
env.update({allowed[k]: v for k, v in options.items()})
env['PGAPPNAME'] = 'durtal-root-reader-schema-read'
# Exact reviewed SQL establishes READ ONLY and SET LOCAL timeouts in the transaction; pooled Neon rejects startup timeouts.
# Any owner-supplied options are preserved above.

inputs=json.loads(Path(spec['base_inputs']['path']).read_bytes())
def check_original(rows, appended=False):
    original = inputs['observed81Rows']
    expected = inputs['expectedMigrations'][82:]
    if (rows[:81] != original or len(rows) != (88 if appended else 81) or
            len({row['id'] for row in rows}) != len(rows)):
        raise RuntimeError('Original81 ledger tuples changed or unexpected ledger cardinality/ids')
    if appended and [(r['hash'], r['created_at']) for r in rows[81:]] != [(e['sha256'], str(e['when'])) for e in expected]:
        raise RuntimeError('Appended7 migration hashes/timestamps differ')
mode=sys.argv[3]; assert mode in ('before','migrate','after')
docker=spec['docker']['path']
def query(label, sql_pin):
    sql=Path(sql_pin['path']).read_bytes()
    assert sql.startswith(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;') and sql.rstrip().endswith(b'ROLLBACK;')
    name='durtal-reader-schema-'+secrets.token_hex(6)
    argv=[docker,'run','--rm','--pull','never','--name',name,'-i']
    for key in sorted(k for k in env if k.startswith('PG')): argv += ['--env',key]
    argv += ['postgres:16','psql','-X','-q','-A','-t','--set','ON_ERROR_STOP=1']
    try:
        result=subprocess.run(argv,input=sql,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=45)
        assert result.returncode==0, 'Read-only capture failed; provider details withheld'
        assert len(result.stdout)<4*1024*1024
        path=out/(label+'.jsonl'); path.write_bytes(result.stdout)
        return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    finally:
        subprocess.run([docker,'rm','--force',name],env=env,capture_output=True,timeout=10)
        settled=subprocess.run([docker,'container','inspect',name],env=env,capture_output=True,timeout=10)
        assert settled.returncode != 0, 'Owned diagnostic client did not settle'
def get_rows(label):
    records=query(label,spec['sql']['ledger']); assert len(records)==1 and records[0]['kind']=='ledger'
    return records[0]['rows']
def save(name,value):
    path=out/name; path.write_text(json.dumps(value,indent=2)+'\n'); return path
binding=hashlib.sha256(values['DATABASE_URL'].encode()).hexdigest()
if mode=='migrate':
    before=json.loads(Path(spec['before_receipt']['path']).read_bytes())
    restored=json.loads(Path(spec['restore_receipt']['path']).read_bytes())
    assert before['status']=='BEFORE_CAPTURE_PASS' and before['databaseBindingSha256']==binding
    assert 0 <= time.time()-before['capturedEpochSeconds'] <= 60
    assert restored['status']=='PASS_LOCAL_REHEARSAL_HISTORY_PRESERVED_WITH_EXCEPTIONS' and restored['backupRestoreVerified'] and restored['oldPublicRowsUnchanged'] and restored['original81Preserved'] and restored['exact7Appended']
    assert restored['cleanup']['ownedContainerRemoved'] is True
    assert restored['inputsSha256']==spec['restored_inputs']['sha256']
    restored_inputs=json.loads(Path(spec['restored_inputs']['path']).read_bytes())
    assert restored_inputs['r16']['commit']==spec['source']['commit'] and restored_inputs['r16']['tree']==spec['source']['tree']
    assert restored_inputs['backup']['sha256']==spec['backup_dump']['sha256']
    assert 0<=time.time()-Path(spec['backup_dump']['path']).stat().st_mtime<3600
    rows=get_rows('immediate-pre-migration-ledger'); check_original(rows); assert rows==before['rows']
    latest=max(int(row['created_at']) for row in rows)
    assert [e['idx'] for e in inputs['expectedMigrations'] if latest<e['when']]==list(range(82,89))
    source=check_source()
    assert digest_file(source/'src/lib/db/migrations/meta/_journal.json')==inputs['journal']['sha256']
    for entry in inputs['expectedMigrations']: assert digest_file(source/'src/lib/db/migrations'/(entry['tag']+'.sql'))==entry['sha256']
    # Existing Root guards/secret hand-off; supported public Drizzle API over mandatory libpq TLS/channel binding.
    child_env=dict(env)
    child_env['PGAPPNAME']='durtal-root-reader-drizzle-libpq-migrate'
    # Raw DATABASE_URL and AWS values never enter the migration child environment.
    child_env['PATH']=str(Path(config['node']['path']).parent)+':/opt/homebrew/bin:/usr/bin:/bin'
    transport=spec['pg_proxy_transport']
    assert transport['runner']['path'] == str(Path(__file__).with_name('drizzle-libpq.mjs'))
    argv=[config['node']['path'],transport['runner']['path'],str(spec_path),sys.argv[2]]
    record={'status':'MIGRATION_STARTED','databaseBindingSha256':binding,'source':spec['source'],'automaticRetry':False}
    save('migration.json',record)
    import threading, runtime_launcher
    log=runtime_launcher.BoundedLog(out/'migration-redacted',values)
    child=subprocess.Popen(argv,cwd=source,env=child_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    readers=[threading.Thread(target=log.consume,args=(stream,),daemon=True) for stream in (child.stdout,child.stderr)]
    for reader in readers: reader.start()
    try:
        code=child.wait(timeout=180)
        for reader in readers: reader.join(timeout=2)
        assert not any(reader.is_alive() for reader in readers), 'Migration output pipes did not settle'
    except BaseException:
        try: os.killpg(child.pid,15); child.wait(timeout=10)
        except subprocess.TimeoutExpired: os.killpg(child.pid,9); child.wait(timeout=10)
        except ProcessLookupError: pass
        record['status']='FAIL_OR_INTERRUPTED_PRESERVE_STATE'; save('migration.json',record); raise
    finally:
        for stream in (child.stdout,child.stderr): stream.close()
        for reader in readers: reader.join(timeout=2)
    record.update(status='MIGRATION_EXIT_ZERO_POST_CAPTURE_REQUIRED' if code==0 else 'MIGRATION_FAILED_PRESERVE_STATE',exitCode=code)
    save('migration.json',record); raise SystemExit(code)
# Existing schema/health probes; no duplicated live full-row audit.
schema=query('schema',spec['sql']['schema']); header=next(r for r in schema if r.get('kind')=='probe')
assert header['readOnly']=='on' and header['ledgerPresent']
rows=get_rows('ledger'); check_original(rows,appended=mode=='after')
if mode=='after':
    before=json.loads(Path(spec['before_receipt']['path']).read_bytes())
    assert before['status']=='BEFORE_CAPTURE_PASS' and before['databaseBindingSha256']==binding and rows[:81]==before['rows']
health=query('health',spec['sql']['health']); assert health==inputs['expectedHealth']
record={'status':'BEFORE_CAPTURE_PASS' if mode=='before' else 'AFTER_CAPTURE_PASS_LEDGER81_PLUS_EXACT7','capturedEpochSeconds':time.time(),'databaseBindingSha256':binding,'source':spec['source'],'rows':rows,'ledgerRows':len(rows),'databaseWrites':0,'containersSettled':True,'schema':{'path':str(out/'schema.jsonl'),'sha256':digest_file(out/'schema.jsonl')},'health':{'path':str(out/'health.jsonl'),'sha256':digest_file(out/'health.jsonl')},'schemaComparison':'Captured actual probe; root reviews against pinned strict restored reference before switch, not inferred from ledger.'}
p=save('receipt.json',record)
if mode=='after':
    save('live-migrations.json',{'version':1,'migrationSha256':hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'evidenceSha256':digest_file(p)})
print(json.dumps({'status':record['status'],'receipt':str(p),'ledgerRows':len(rows)}))
