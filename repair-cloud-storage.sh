#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Run from a clean clone in Google Cloud Shell. Existing cloud records are kept.
QP_PROJECT=$(gcloud config get-value project 2>/dev/null)
QP_REGION=asia-south1
QP_SERVICE=phd-portal
QP_PROJECT_NUMBER=$(gcloud projects describe "$QP_PROJECT" --format='value(projectNumber)')
if [ "$QP_PROJECT_NUMBER" != '873642688907' ]; then
  echo 'Select the project containing phd-portal-873642688907 in Cloud Console, then run this script again.' >&2
  exit 1
fi

QP_CONFIG=$(mktemp)
trap 'rm -f "$QP_CONFIG"' EXIT
gcloud run services describe "$QP_SERVICE" --project="$QP_PROJECT" --region="$QP_REGION" --format=json > "$QP_CONFIG"
QP_ACCOUNT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["spec"]["template"]["spec"].get("serviceAccountName", ""))' "$QP_CONFIG")
QP_BUCKET=$(python3 -c 'import json,sys; c=json.load(open(sys.argv[1]))["spec"]["template"]["spec"]["containers"][0]; print(next((v.get("value", "") for v in c.get("env", []) if v["name"]=="GCS_BUCKET_NAME"), ""))' "$QP_CONFIG")
QP_BUCKET=${QP_BUCKET:-pragmatic-app-505807-g5-phd-portal-docs}
QP_ACCOUNT=${QP_ACCOUNT:-${QP_PROJECT_NUMBER}-compute@developer.gserviceaccount.com}

test -s data/papers.db || { echo 'Recovery database data/papers.db is missing from this clone.' >&2; exit 1; }
test -s data/phd_admissions.db || { echo 'Admissions database is missing from this clone.' >&2; exit 1; }
python3 - <<'PY'
import pathlib, sqlite3
db=sqlite3.connect('file:data/papers.db?mode=ro', uri=True)
assert db.execute('PRAGMA quick_check').fetchone()[0]=='ok', 'Recovery database is invalid'
for (file,) in db.execute('SELECT path FROM papers UNION SELECT path FROM templates UNION SELECT path FROM generations'):
    name=file.replace('\\', '/').split('/')[-1]
    assert pathlib.Path('data/files', name).is_file(), 'Recovery Word document missing: '+name
print('Verified recovery data:', db.execute('SELECT kind, COUNT(*) FROM papers GROUP BY kind').fetchall())
db.close()
PY

if ! gcloud storage buckets describe "gs://$QP_BUCKET" --project="$QP_PROJECT" >/dev/null; then
  gcloud storage buckets create "gs://$QP_BUCKET" --project="$QP_PROJECT" \
    --location="$QP_REGION" --uniform-bucket-level-access --public-access-prevention
fi
# Only the existing app service account receives access, scoped to this bucket.
gcloud storage buckets add-iam-policy-binding "gs://$QP_BUCKET" \
  --member="serviceAccount:$QP_ACCOUNT" --role=roles/storage.objectUser --project="$QP_PROJECT" >/dev/null

gcloud run deploy "$QP_SERVICE" --project="$QP_PROJECT" --region="$QP_REGION" \
  --source=. --port=8080 --memory=1Gi --cpu=1 --concurrency=1 --max=1 --max-instances=1 \
  --session-affinity --timeout=300 \
  --startup-probe='httpGet.path=/health,httpGet.port=8080,periodSeconds=24,timeoutSeconds=5,failureThreshold=10' \
  --update-env-vars="GCS_BUCKET_NAME=$QP_BUCKET,QUESTION_PAPER_DATA_DIR=/tmp/qp-runtime,QUESTION_PAPER_SEED_DIR=/app/data,ADMISSIONS_DB=/app/data/phd_admissions.db"

QP_URL=$(gcloud run services describe "$QP_SERVICE" --project="$QP_PROJECT" --region="$QP_REGION" --format='value(status.url)')
curl --fail --silent --show-error "$QP_URL/health"
echo
echo "Open $QP_URL and sign in again. The administrator dashboard should show at least 156 past papers."
echo "Authenticated storage diagnostics: $QP_URL/api/storage-status"
gcloud run services logs read "$QP_SERVICE" --project="$QP_PROJECT" --region="$QP_REGION" --limit=20
