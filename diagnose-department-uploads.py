"""Read-only cloud diagnosis for Trichy Clinical Psychology and Cardiac Care uploads."""
import contextlib
import importlib.util
import json
import pathlib
import re
import sqlite3
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recovery', ROOT / 'restore-removed-archives.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


def table_rows(db, table, fields):
    if not db.execute('SELECT 1 FROM sqlite_master WHERE type=? AND name=?', ('table', table)).fetchone():
        return []
    db.row_factory = sqlite3.Row
    return [dict(row) for row in db.execute('SELECT ' + fields + ' FROM ' + table)]


def is_target(name):
    return bool(re.search(r'clinical.*psyc|cardia[cl]|cardio', str(name), re.I))


def diagnose(db, admissions):
    institutions = {row['id']: row for row in table_rows(admissions, 'institutions', 'id,name,campus_id')}
    base = table_rows(admissions, 'departments', 'id,name,institution_id')
    custom = table_rows(db, 'custom_departments', 'id,name,institution_id,hod_user_id')
    users = table_rows(admissions, 'users', 'id,username,name,role,campus_id,department_id')
    users += table_rows(db, 'portal_users', 'id,username,name,role,campus_id,department_id')
    credentials = {r['user_id']: r for r in table_rows(db, 'user_credentials', 'user_id,must_change_password')}
    targets = []
    for row in base + custom:
        institution = institutions.get(row['institution_id'], {})
        if not is_target(row['name']) or institution.get('campus_id') != 2:
            continue
        assigned = next((u for u in users if u['id'] == row.get('hod_user_id')), None) if row in custom else next((u for u in users if u['role'] == 'hod' and u['department_id'] == row['id'] and u['campus_id'] == 2), None)
        issue = None
        if not assigned:
            issue = 'No HoD account is assigned. This department cannot receive HoD submissions.'
        elif assigned['role'] != 'hod' or assigned['campus_id'] != 2:
            issue = 'Assigned account is not a Trichy HoD. Upload permission will be refused.'
        elif sum(u['username'].lower() == assigned['username'].lower() for u in users) > 1:
            issue = 'Duplicate login username; the first account may hide the assigned HoD account.'
        elif credentials.get(assigned['id'], {}).get('must_change_password'):
            issue = 'Temporary password must be changed in Change password before uploading.'
        targets.append({**row, 'campus': 'Trichy', 'institution': institution.get('name'), 'custom': row in custom,
                        'hod': assigned, 'mapping_issue': issue})
    print('Department mappings (from this checkout and the live portal database):')
    for target in targets:
        print(json.dumps(target, ensure_ascii=False))
    cardiac = [d for d in targets if re.search(r'cardia[cl]|cardio', d['name'], re.I)]
    if not cardiac:
        print('Cardiac Care Technology was not found in the Trichy department registry.')
    ids = {d['id'] for d in cardiac}
    candidate_ids = {d['hod']['id'] for d in cardiac if d['hod']}
    candidates = [u for u in users if u['campus_id'] == 2 and u['role'] == 'hod' and
                  (u['id'] in candidate_ids or re.search(r'cardia[cl]|cardio|\bcct\b|_cct_', u['username'] + ' ' + u['name'], re.I))]
    print('Relevant HoD accounts (no passwords):', json.dumps(candidates, ensure_ascii=False))
    papers = table_rows(db, 'papers', '*')
    for paper in papers:
        if paper['department_id'] in ids:
            fields = ('id', 'department_id', 'session', 'set_name', 'kind', 'original_name', 'uploaded_by', 'counts', 'valid', 'reviewed', 'created_at', 'deleted_at')
            print('Paper:', json.dumps({key: paper.get(key) for key in fields}, ensure_ascii=False))
    events = table_rows(db, 'audit_events', 'actor_id,actor_username,action,created_at,details')
    relevant = []
    for event in events:
        try:
            details = json.loads(event['details'])
        except (ValueError, TypeError):
            continue
        if event['actor_id'] not in candidate_ids and str(details.get('department_id')) not in {str(i) for i in ids} and not re.search(r'cardia[cl]|cardio', str(details.get('department', '')), re.I):
            continue
        allowed = ('filename', 'department', 'department_id', 'session', 'set', 'reason', 'matched_questions')
        relevant.append({**{key: event[key] for key in ('actor_username', 'action', 'created_at')},
                         'details': {key: details[key] for key in allowed if key in details}})
    print('Latest relevant activity (no passwords or question text):')
    for event in sorted(relevant, key=lambda e: e['created_at'], reverse=True)[:15]:
        print(json.dumps(event, ensure_ascii=False))
    return targets


def main():
    cloud = recovery.Cloud()
    service = json.loads(cloud.command('run', 'services', 'describe', recovery.SERVICE,
                                      '--region=' + recovery.REGION, '--format=json'))
    container = service['spec']['template']['spec']['containers'][0]
    bucket = next((v.get('value', '') for v in container.get('env', []) if v.get('name') == 'GCS_BUCKET_NAME'), '')
    if not bucket or '/' in bucket:
        raise RuntimeError('The live service has no valid bucket setting.')
    uri = 'gs://' + bucket + '/' + recovery.DATABASE_KEY
    expected = recovery.generation(cloud.metadata(uri))
    print('Serving revision:', service.get('status', {}).get('latestReadyRevisionName'))
    with tempfile.TemporaryDirectory(prefix='phd-department-check-') as temporary:
        local = pathlib.Path(temporary) / 'papers.db'
        cloud.download(uri, local)
        if recovery.generation(cloud.metadata(uri)) != expected:
            raise RuntimeError('The app saved data during inspection. Rerun this read-only check.')
        admissions = ROOT / 'data' / 'phd_admissions.db'
        with contextlib.closing(sqlite3.connect(local.as_uri() + '?mode=ro', uri=True)) as db, contextlib.closing(sqlite3.connect(admissions.as_uri() + '?mode=ro', uri=True)) as source:
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('The cloud database failed its integrity check.')
            diagnose(db, source)
    query = 'resource.type="cloud_run_revision" AND resource.labels.service_name="phd-portal" AND (severity>=ERROR OR textPayload:"authorized department" OR textPayload:"assigned HoD" OR textPayload:"Word document" OR textPayload:"upload")'
    print('Recent application errors / upload messages:')
    try:
        print(cloud.command('logging', 'read', query, '--freshness=7d', '--limit=25', '--format=value(textPayload)') or 'No matching application messages were found.')
    except subprocess.CalledProcessError as error:
        print('Logs could not be read:', error.stderr.strip())
    print('Read-only check complete. No cloud records, accounts or documents were changed.')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit('Cloud command failed: ' + error.stderr.strip())
    except (RuntimeError, sqlite3.DatabaseError, KeyError, ValueError) as error:
        raise SystemExit(str(error))
