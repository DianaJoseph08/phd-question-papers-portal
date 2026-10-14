# Recovering the hosted archive

The deployed app uses Cloud Run and a private Cloud Storage bucket. The local recovery library contains 156 current archive papers, four current submissions, and two templates. Older versions are retained as separate database rows.

## Run the repair in Google Cloud Shell

Pause uploads during this one-time repair. Select the project for service `phd-portal` (project number `873642688907`) and open Cloud Shell. Use a fresh folder so an existing checkout is preserved:

```bash
QP_REPAIR_DIR=$(mktemp -d "$HOME/phd-portal-repair.XXXXXX")
git clone --branch main https://github.com/DianaJoseph08/phd-question-papers-portal.git "$QP_REPAIR_DIR"
cd "$QP_REPAIR_DIR"
bash repair-cloud-storage.sh
```

The script validates the project and recovery files, reads the existing bucket setting and service account, grants that account Storage Object User on this bucket only, and deploys the repaired app. It creates the default bucket only if needed. Do not grant public access to the bucket. Existing app access settings are retained.

The deployment uses one instance, concurrency 1 and session affinity. Sign in again after deployment because login sessions are held in memory. Changing the running revision resets sessions, not saved papers.

## What the repair does

- Restores the cloud database before opening SQLite or accepting requests.
- Adds missing recovery records without overwriting records with the same primary key in the cloud. Newer cloud submissions remain the current versions.
- Keeps a copy of the pre-recovery cloud database under `recovery/` when merging rows.
- Ensures all referenced Word files are in the bucket before publishing the restored database.
- Handles document paths recorded on Windows when the service runs on Linux.
- Waits for Word uploads and a consistent database snapshot before confirming a save.
- Uses generation preconditions to reject conflicting updates rather than overwrite another instance's saved data. An affected user receives a retry message.
- Loads documents from the bucket for downloads, repeat checking and final-paper generation.
- Stops on cloud startup/permission failures instead of serving an empty temporary database.

## Verification

After deployment, sign in as administrator at the existing app URL. The overview should show at least 156 past papers. Download one January and one July paper. `/api/storage-status` is available to a signed-in administrator and reports storage mode, bucket, record totals and templates.

The script prints recent service logs. A successful start includes `[Storage] Ready:`. If startup fails, keep the error output and resolve the reported bucket permission or missing file; do not replace the cloud database manually.

## Restore accidentally removed past papers

From an up-to-date checkout in Cloud Shell, run:

```bash
bash restore-removed-archives.sh --apply
```

This restores the latest removed January/July 2026 archive for each department, campus, session and set. A newer uploaded version takes precedence, including when timestamps match. Older superseded versions and January 2027 submissions are excluded. Original upload details are retained and each restoration receives a `paper.restored` admin audit entry identifying the active Cloud Shell account.

The script reads the running service's bucket setting, checks the original Word files, saves a private database backup under `recovery/`, and publishes a snapshot with a generation-match precondition. If another save occurs first, it refuses to overwrite it and asks you to rerun the command. A missing Word file is recovered only when its exact stored filename exists in the repository's recovery files; otherwise recovery stops before publishing the database. Refresh the portal after the verified success message; deployment is not required. Run without `--apply` to preview the affected records without changing cloud data.

Recovery tests use isolated fixtures: `python3 restore-removed-archives.test.py`.

## Limits

If a generated set is missing, run `bash diagnose-generated-papers.sh` from an up-to-date checkout in Cloud Shell before attempting another repair. This read-only script reports the active revision and traffic, inspects a temporary copy of the cloud database, lists Civil Engineering's saved generation history and latest A/B records, checks whether their Word files exist, and reads generation request/error logs. It does not change the service, bucket objects or database and does not print question text or account passwords. Paste its terminal output for diagnosis. A generation button click alone does not confirm a saved paper; the success dialog must appear after the cloud commit.

This is a small-portal snapshot design. Each mutation writes a whole SQLite snapshot; use a managed transactional database before increasing scale. Conflicting requests fail for retry, and a network failure after cloud acknowledgement may leave an operation saved even when the client did not receive the response. Check the library before resubmitting after a network error. No software can promise zero data loss under every failure.

`data/papers.db`, `data/phd_admissions.db` and `data/files/` were already included in this repository by the earlier deployment. Keep that repository and its build artifacts private. The repair commits contain code, tests and documentation only; recovery snapshots outside the app folder are not pushed.
