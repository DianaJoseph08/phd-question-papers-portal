#!/usr/bin/env bash
# Read-only: inspect the running service and a private copy of its cloud database.
set -euo pipefail
QP_DIAG_PROJECT=pragmatic-app-505807-g5
QP_DIAG_REGION=asia-south1
QP_DIAG_SERVICE=phd-portal
QP_DIAG_DIR=$(mktemp -d /tmp/phd-generation-check.XXXXXX)
trap 'rm -rf -- "$QP_DIAG_DIR"' EXIT

gcloud run services describe "$QP_DIAG_SERVICE" --project="$QP_DIAG_PROJECT" \
  --region="$QP_DIAG_REGION" --format=json > "$QP_DIAG_DIR/service.json"
QP_DIAG_BUCKET=$(python3 - "$QP_DIAG_DIR/service.json" <<'PY'
import json, sys
service = json.load(open(sys.argv[1]))
container = service['spec']['template']['spec']['containers'][0]
bucket = next((v.get('value', '') for v in container.get('env', []) if v['name'] == 'GCS_BUCKET_NAME'), '')
if not bucket:
    raise SystemExit('The service has no GCS_BUCKET_NAME. No database was changed.')
print(bucket)
PY
)
printf 'Storage bucket: %s\n' "$QP_DIAG_BUCKET"
python3 - "$QP_DIAG_DIR/service.json" <<'PY'
import json, sys
service = json.load(open(sys.argv[1]))
print('Ready revision:', service.get('status', {}).get('latestReadyRevisionName'))
for route in service.get('status', {}).get('traffic', []):
    print('Traffic:', route.get('revisionName'), str(route.get('percent', 0)) + '%')
PY

gcloud storage cp "gs://$QP_DIAG_BUCKET/database/papers.db" "$QP_DIAG_DIR/papers.db" \
  --project="$QP_DIAG_PROJECT" >/dev/null
python3 - "$QP_DIAG_DIR/papers.db" "$QP_DIAG_DIR/current-files.txt" <<'PY'
import datetime, json, pathlib, sqlite3, sys
database = pathlib.Path(sys.argv[1]).resolve()
db = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
db.row_factory = sqlite3.Row
assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok', 'Cloud database integrity check failed'
print('Total saved generated papers:', db.execute('SELECT COUNT(*) FROM generations').fetchone()[0])
rows = db.execute("SELECT id,department_key,department_name,set_name,path,distribution,created_at FROM generations WHERE lower(department_name) LIKE '%civil%' ORDER BY created_at DESC,rowid DESC").fetchall()
print('Civil generation history:')
latest = {}
ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
for row in rows:
    stamp = datetime.datetime.fromisoformat(row['created_at'].replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=datetime.timezone.utc)
    print(' ', row['department_key'], 'Set ' + row['set_name'], stamp.astimezone(ist).strftime('%d-%m-%Y %I:%M:%S %p IST'), 'ID=' + row['id'], 'campuses=' + row['distribution'])
    latest.setdefault((row['department_key'], row['set_name']), row)
groups = sorted({row['department_key'] for row in rows})
if not groups:
    print('No Civil generated records exist in the cloud database.')
for group in groups:
    for name in ['A', 'B']:
        row = latest.get((group, name))
        print('Current final:', group, 'Set ' + name, row['id'] if row else 'NOT SAVED')
paths = sorted({str(row['path']).replace('\\', '/').split('/')[-1] for row in latest.values()})
pathlib.Path(sys.argv[2]).write_text('\n'.join(paths) + ('\n' if paths else ''), encoding='utf-8')
print('Recent generation audit entries:')
exists = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_events'").fetchone()
if exists:
    for row in db.execute("SELECT created_at,actor_name,action,details FROM audit_events WHERE action='paper.generated' ORDER BY created_at DESC,rowid DESC LIMIT 10"):
        details = json.loads(row['details'])
        print(' ', row['created_at'], row['actor_name'], details.get('department'), 'Set', details.get('set'))
db.close()
PY

while IFS= read -r QP_DIAG_FILE; do
  if gcloud storage objects describe "gs://$QP_DIAG_BUCKET/files/$QP_DIAG_FILE" \
    --project="$QP_DIAG_PROJECT" --format='value(name)' >/dev/null; then
    printf 'Word file PRESENT: %s\n' "$QP_DIAG_FILE"
  else
    printf 'Word file MISSING or inaccessible: %s\n' "$QP_DIAG_FILE"
  fi
done < "$QP_DIAG_DIR/current-files.txt"

printf '\nRecent service logs (generation warnings or failed requests may appear here):\n'
gcloud run services logs read "$QP_DIAG_SERVICE" --project="$QP_DIAG_PROJECT" \
  --region="$QP_DIAG_REGION" --limit=40 \
  --log-filter='httpRequest.requestUrl:"/api/generate" OR severity>=ERROR OR logName:"stderr"'
printf '\nDiagnostic complete. No cloud records or files were changed.\n'
