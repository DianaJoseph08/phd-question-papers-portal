"""Restore only current, soft-removed 2026 archive sets in the live cloud database."""
import argparse
import contextlib
import datetime
import json
import pathlib
import re
import sqlite3
import subprocess
import tempfile
import uuid

PROJECT = 'pragmatic-app-505807-g5'
REGION = 'asia-south1'
SERVICE = 'phd-portal'
DATABASE_KEY = 'database/papers.db'


def removed_current_archives(db):
    columns = {row[1] for row in db.execute('PRAGMA table_info(papers)')}
    if 'deleted_at' not in columns:
        return []
    db.row_factory = sqlite3.Row
    return [dict(row) for row in db.execute("""
        SELECT p.* FROM papers p
        WHERE p.kind='archive' AND p.session IN ('January 2026','July 2026')
          AND p.deleted_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM papers newer
            WHERE newer.department_id=p.department_id AND newer.campus_id=p.campus_id
              AND newer.session=p.session AND newer.set_name=p.set_name AND newer.kind=p.kind
              AND (newer.created_at>p.created_at
                OR (newer.created_at=p.created_at AND newer.rowid>p.rowid))
          )
        ORDER BY p.department_id,p.campus_id,p.session,p.set_name
    """)]


def restore_rows(db, rows, actor, operation):
    eligible = {row['id'] for row in removed_current_archives(db)}
    if any(row['id'] not in eligible for row in rows):
        raise RuntimeError('The recovery plan is stale. No restoration was applied.')
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    columns = {row[1] for row in db.execute('PRAGMA table_info(papers)')}
    with db:
        db.execute("""CREATE TABLE IF NOT EXISTS audit_events (
            id TEXT PRIMARY KEY,actor_id INTEGER,actor_username TEXT,actor_name TEXT,
            action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,
            details TEXT NOT NULL,created_at TEXT NOT NULL)""")
        for row in rows:
            changes = 'deleted_at=NULL' + (',deleted_by=NULL' if 'deleted_by' in columns else '')
            result = db.execute(f'UPDATE papers SET {changes} WHERE id=? AND deleted_at=?',
                                (row['id'], row['deleted_at']))
            if result.rowcount != 1:
                raise RuntimeError('A recovery record changed; no restoration was applied.')
            details = {
                'filename': row['original_name'], 'department_id': row['department_id'],
                'campus_id': row['campus_id'], 'session': row['session'],
                'set': row['set_name'], 'kind': 'archive',
                'previous_deleted_at': row['deleted_at'],
                'previous_deleted_by': row.get('deleted_by'),
                'reason': 'Restore accidentally removed past-session paper at administrator request',
                'recovery_operation': operation,
            }
            db.execute('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)',
                       (str(uuid.uuid4()), None, actor, 'Cloud Shell archive recovery',
                        'paper.restored', 'paper', row['id'], json.dumps(details), now))


class Cloud:
    def command(self, *args):
        return subprocess.run(['gcloud', *args, '--project=' + PROJECT],
                              check=True, text=True, capture_output=True).stdout.strip()

    def metadata(self, uri):
        try:
            return json.loads(self.command('storage', 'objects', 'describe', uri, '--raw', '--format=json'))
        except subprocess.CalledProcessError as error:
            if re.search(r'\b404\b|\bNotFound\b|\bnot found\b', error.stderr, re.I):
                return None
            raise

    def download(self, uri, destination):
        self.command('storage', 'cp', uri, str(destination))

    def upload(self, source, uri, generation):
        self.command('storage', 'cp', str(source), uri,
                     '--if-generation-match=' + str(generation), '--cache-control=no-store')


def generation(metadata):
    value = str((metadata or {}).get('generation', ''))
    if not value.isdigit() or int(value) <= 0:
        raise RuntimeError('The live database generation could not be verified.')
    return value


def recover(cloud, apply=False, seed=None):
    service = json.loads(cloud.command('run', 'services', 'describe', SERVICE,
                                      '--region=' + REGION, '--format=json'))
    container = service['spec']['template']['spec']['containers'][0]
    bucket = next((v.get('value', '') for v in container.get('env', [])
                   if v.get('name') == 'GCS_BUCKET_NAME'), '')
    if not bucket or '/' in bucket:
        raise RuntimeError('No valid private storage bucket was found on the service.')
    uri = 'gs://' + bucket + '/' + DATABASE_KEY
    expected = generation(cloud.metadata(uri))
    with tempfile.TemporaryDirectory(prefix='phd-archive-restore-') as temporary:
        directory = pathlib.Path(temporary)
        database = directory / 'papers.db'
        cloud.download(uri, database)
        if generation(cloud.metadata(uri)) != expected:
            raise RuntimeError('Cloud data changed during inspection. Rerun the command; nothing was restored.')
        with contextlib.closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as db:
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Database integrity check failed; nothing was restored.')
            rows = removed_current_archives(db)
        print('Removed current past-session sets:', len(rows))
        for row in rows:
            print(' ', 'Department', row['department_id'], '| Campus', row['campus_id'],
                  '|', row['session'], '| Set', row['set_name'], '|', row['original_name'])
        if not rows:
            print('No removed current January/July 2026 sets need restoration.')
            return 0
        documents = {}
        for row in rows:
            name = str(row['path']).replace('\\', '/').split('/')[-1]
            if name in ('', '.', '..') or not name.lower().endswith('.docx'):
                raise RuntimeError('An archive document path is invalid; nothing was restored.')
            object_uri = 'gs://' + bucket + '/files/' + name
            if cloud.metadata(object_uri):
                continue
            candidate = (seed / 'files' / name).resolve() if seed else None
            if not candidate or candidate.parent != (seed / 'files').resolve() or not candidate.is_file():
                raise RuntimeError('A removed archive has no recoverable Word file: ' + name)
            documents[object_uri] = candidate
        if not apply:
            print('Preview only. Run with --apply to restore these sets.')
            return len(rows)
        actor = cloud.command('auth', 'list', '--filter=status:ACTIVE', '--format=value(account)').splitlines()
        if len(actor) != 1 or not actor[0].strip():
            raise RuntimeError('The active Cloud Shell account could not be identified; nothing was restored.')
        operation = 'archive-restore-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex
        backup = 'gs://' + bucket + '/recovery/' + operation + '-before.db'
        cloud.upload(database, backup, 0)
        print('Recovery backup:', backup)
        for object_uri, candidate in documents.items():
            cloud.upload(candidate, object_uri, 0)
        with contextlib.closing(sqlite3.connect(database)) as db:
            restore_rows(db, rows, actor[0].strip(), operation)
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Restored database failed validation; cloud data was not changed.')
        try:
            cloud.upload(database, uri, expected)
        except subprocess.CalledProcessError as error:
            if re.search(r'\b412\b|precondition|conditionNotMet', error.stderr, re.I):
                raise RuntimeError('Another portal save completed first. Rerun this command; the newer data was preserved.') from error
            raise
        verified = directory / 'verified.db'
        cloud.download(uri, verified)
        with contextlib.closing(sqlite3.connect(verified.as_uri() + '?mode=ro', uri=True)) as db:
            for row in rows:
                result = db.execute('SELECT deleted_at FROM papers WHERE id=?', (row['id'],)).fetchone()
                if not result or result[0] is not None:
                    raise RuntimeError('Recovery was published but a record changed before verification. Check the portal before retrying.')
        print('Restored and verified', len(rows), 'past-session set(s).')
        print('Refresh Question papers in the portal. No deployment is needed.')
        return len(rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='restore the listed past-session sets')
    args = parser.parse_args()
    try:
        recover(Cloud(), apply=args.apply, seed=pathlib.Path(__file__).resolve().parent / 'data')
    except subprocess.CalledProcessError as error:
        parser.exit(1, 'Cloud command failed: ' + error.stderr.strip() + '\n')
    except (RuntimeError, sqlite3.DatabaseError, KeyError, ValueError) as error:
        parser.exit(1, str(error) + '\n')
