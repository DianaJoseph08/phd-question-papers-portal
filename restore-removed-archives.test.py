import contextlib
import importlib.util
import io
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('recovery', pathlib.Path(__file__).with_name('restore-removed-archives.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


def fixture(file):
    db = sqlite3.connect(file)
    db.executescript('''
        CREATE TABLE papers(id TEXT PRIMARY KEY,department_id INTEGER,campus_id INTEGER,
          session TEXT,set_name TEXT,kind TEXT,original_name TEXT,path TEXT,uploaded_by INTEGER,
          created_at TEXT,deleted_at TEXT,deleted_by INTEGER,counts TEXT,reviewed INTEGER);
        CREATE TABLE user_credentials(user_id INTEGER,password_hash TEXT);
        INSERT INTO user_credentials VALUES(1,'unchanged-test-value');
        CREATE TABLE generations(id TEXT,manifest TEXT);
        INSERT INTO generations VALUES('saved-a','unchanged-source-record');
    ''')
    def add(id, department=4, campus=1, session='January 2026', set='A', kind='archive', created='2026-10-01', removed='2026-10-14'):
        db.execute('INSERT INTO papers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                   (id, department, campus, session, set, kind, id + '.docx',
                    'D:\\old\\files\\' + id + '.docx', 7, created, removed,
                    3 if removed else None, '{"research":25,"subject":25}', 1))
    add('restore-a')
    add('superseded-b', set='B')
    add('current-b', set='B', created='2026-10-02', removed=None)
    add('historical-c', department=5)
    add('restore-latest-c', department=5, created='2026-10-02')
    add('restore-tie-d', department=6)
    add('current-tie-d', department=6, removed=None)
    add('upcoming', session='January 2027', kind='submission')
    add('other-session', department=9, session='July 2025')
    add('restore-trichy-july', campus=2, session='July 2026')
    db.commit()
    db.close()


class FakeCloud:
    def __init__(self, content):
        self.objects = {'gs://test-bucket/database/papers.db': content}
        self.versions = {key: '1' for key in self.objects}
        self.uploads = []
        self.conflict = False
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'inspect.db'
            path.write_bytes(content)
            with contextlib.closing(sqlite3.connect(path)) as db:
                for name, in db.execute('SELECT id FROM papers'):
                    self.objects['gs://test-bucket/files/' + name + '.docx'] = b'word-fixture'
    def command(self, *args):
        if args[:3] == ('run', 'services', 'describe'):
            return json.dumps({'spec': {'template': {'spec': {'containers': [{'env': [{'name': 'GCS_BUCKET_NAME', 'value': 'test-bucket'}]}]}}}})
        if args[:2] == ('auth', 'list'):
            return 'admin@example.test'
        raise AssertionError(args)
    def metadata(self, uri):
        return {'generation': self.versions.get(uri, '1')} if uri in self.objects else None
    def download(self, uri, path):
        path.write_bytes(self.objects[uri])
    def upload(self, path, uri, expected):
        actual = self.versions.get(uri, '1' if uri in self.objects else '0')
        if str(expected) != actual or (self.conflict and uri.endswith('/database/papers.db')):
            raise subprocess.CalledProcessError(1, ['gcloud'], stderr='412 conditionNotMet')
        self.objects[uri] = path.read_bytes()
        self.versions[uri] = str(int(actual) + 1)
        self.uploads.append(uri)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='qp-recovery-test-')
        self.addCleanup(self.temp.cleanup)
        self.file = pathlib.Path(self.temp.name) / 'papers.db'
        fixture(self.file)
        self.cloud = FakeCloud(self.file.read_bytes())
        self.output = io.StringIO()
    def run_recovery(self, **kwargs):
        with contextlib.redirect_stdout(self.output):
            return recovery.recover(self.cloud, **kwargs)
    def cloud_rows(self, table):
        path = pathlib.Path(self.temp.name) / 'result.db'
        path.write_bytes(self.cloud.objects['gs://test-bucket/database/papers.db'])
        with contextlib.closing(sqlite3.connect(path)) as db:
            return db.execute('SELECT * FROM ' + table).fetchall()
    def test_selects_latest_removed_past_sets_only(self):
        with contextlib.closing(sqlite3.connect(self.file)) as db:
            self.assertEqual({r['id'] for r in recovery.removed_current_archives(db)},
                             {'restore-a', 'restore-latest-c', 'restore-trichy-july'})
    def test_preview_makes_no_cloud_writes(self):
        before = dict(self.cloud.objects)
        self.assertEqual(self.run_recovery(), 3)
        self.assertEqual(self.cloud.objects, before)
        self.assertEqual(self.cloud.uploads, [])
    def test_apply_preserves_uploads_accounts_finals_and_history_and_adds_audit(self):
        self.assertEqual(self.run_recovery(apply=True), 3)
        result = {row[0]: row for row in self.cloud_rows('papers')}
        for id in ['restore-a', 'restore-latest-c', 'restore-trichy-july']:
            self.assertIsNone(result[id][10])
            self.assertIsNone(result[id][11])
            self.assertEqual(result[id][8], 7)
        self.assertIsNotNone(result['superseded-b'][10])
        self.assertIsNotNone(result['historical-c'][10])
        self.assertIsNotNone(result['restore-tie-d'][10])
        self.assertIsNotNone(result['upcoming'][10])
        self.assertEqual(self.cloud_rows('user_credentials'), [(1, 'unchanged-test-value')])
        self.assertEqual(self.cloud_rows('generations'), [('saved-a', 'unchanged-source-record')])
        events = self.cloud_rows('audit_events')
        self.assertEqual(len(events), 3)
        self.assertTrue(all(row[2] == 'admin@example.test' and row[4] == 'paper.restored' for row in events))
        backups = [key for key in self.cloud.uploads if '/recovery/' in key]
        self.assertEqual(len(backups), 1)
        self.assertEqual(self.cloud.objects[backups[0]], self.file.read_bytes())
        self.assertEqual(self.run_recovery(apply=True), 0)
    def test_concurrent_save_refuses_overwrite(self):
        before = self.cloud.objects['gs://test-bucket/database/papers.db']
        self.cloud.conflict = True
        with self.assertRaisesRegex(RuntimeError, 'newer data was preserved'):
            self.run_recovery(apply=True)
        self.assertEqual(self.cloud.objects['gs://test-bucket/database/papers.db'], before)
    def test_missing_word_file_stops_before_any_cloud_write(self):
        del self.cloud.objects['gs://test-bucket/files/restore-a.docx']
        with self.assertRaisesRegex(RuntimeError, 'no recoverable Word file'):
            self.run_recovery(apply=True)
        self.assertEqual(self.cloud.uploads, [])
    def test_changed_database_during_download_aborts_before_backup_or_write(self):
        original_download = self.cloud.download
        def changed_download(uri, path):
            original_download(uri, path)
            self.cloud.versions[uri] = '2'
        self.cloud.download = changed_download
        with self.assertRaisesRegex(RuntimeError, 'Cloud data changed during inspection'):
            self.run_recovery(apply=True)
        self.assertEqual(self.cloud.uploads, [])
    def test_backup_failure_keeps_live_database_unchanged(self):
        before = self.cloud.objects['gs://test-bucket/database/papers.db']
        def denied_upload(path, uri, expected):
            raise subprocess.CalledProcessError(1, ['gcloud'], stderr='403 Forbidden')
        self.cloud.upload = denied_upload
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_recovery(apply=True)
        self.assertEqual(self.cloud.objects['gs://test-bucket/database/papers.db'], before)
    def test_missing_word_can_be_recovered_from_the_matching_seed_file(self):
        key = 'gs://test-bucket/files/restore-a.docx'
        del self.cloud.objects[key]
        seed = pathlib.Path(self.temp.name) / 'seed'
        (seed / 'files').mkdir(parents=True)
        (seed / 'files' / 'restore-a.docx').write_bytes(b'recovered-original')
        self.assertEqual(self.run_recovery(apply=True, seed=seed), 3)
        self.assertEqual(self.cloud.objects[key], b'recovered-original')
    def test_old_database_without_removal_columns_is_unchanged(self):
        path = pathlib.Path(self.temp.name) / 'old.db'
        with contextlib.closing(sqlite3.connect(path)) as db:
            db.execute('CREATE TABLE papers(id TEXT)')
            self.assertEqual(recovery.removed_current_archives(db), [])


if __name__ == '__main__':
    unittest.main()
