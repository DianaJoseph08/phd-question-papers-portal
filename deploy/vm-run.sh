#!/bin/sh
set -eu

# Run this on the Compute Engine VM after /mnt/disks/qp-data contains:
#   phd_admissions.db
#   data/papers.db and data/files/
# The repository is checked out at /opt/question-paper-app.

APP_DIR=${APP_DIR:-/opt/question-paper-app}
RUNTIME_DIR=${RUNTIME_DIR:-/mnt/disks/qp-data}
IMAGE=${IMAGE:-srmist-question-paper-app:local}

test -f "$RUNTIME_DIR/phd_admissions.db" || { echo "Missing $RUNTIME_DIR/phd_admissions.db" >&2; exit 1; }
test -f "$RUNTIME_DIR/data/papers.db" || { echo "Missing $RUNTIME_DIR/data/papers.db" >&2; exit 1; }
mkdir -p "$RUNTIME_DIR/data/files"

cd "$APP_DIR"
docker build --pull -t "$IMAGE" .
docker rm -f question-paper-app 2>/dev/null || true
docker run -d --name question-paper-app --restart unless-stopped \
  -p 80:3100 \
  -e HOST=0.0.0.0 \
  -e PORT=3100 \
  -e TRUST_PROXY=1 \
  -e ADMISSIONS_DB=/runtime/phd_admissions.db \
  -e QUESTION_PAPER_DATA_DIR=/runtime/data \
  -v "$RUNTIME_DIR:/runtime" \
  "$IMAGE"

docker ps --filter name=question-paper-app
