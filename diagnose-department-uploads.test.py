import contextlib
import importlib.util
import io
import pathlib
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location('diagnosis', pathlib.Path(__file__).with_name('diagnose-department-uploads.py'))
diagnosis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnosis)


class DiagnosisTests(unittest.TestCase):
    def setUp(self):
        self.source = sqlite3.connect(':memory:')
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.source.close)
        self.addCleanup(self.db.close)
        self.source.executescript("""
            CREATE TABLE institutions(id INTEGER,name TEXT,campus_id INTEGER);
            INSERT INTO institutions VALUES(5,'College of Engineering and Technology',2),(7,'College of Allied Health Sciences',2),(1,'Ramapuram',1);
            CREATE TABLE departments(id INTEGER,name TEXT,institution_id INTEGER);
            INSERT INTO departments VALUES(105,'CLINICAL PSYCOLOGY',5),(45,'Clinical Psychology',7),(99,'Cardiac Care Technology',1);
            CREATE TABLE users(id INTEGER,username TEXT,name TEXT,role TEXT,campus_id INTEGER,department_id INTEGER,password TEXT);
            INSERT INTO users VALUES(53,'clinical','Clinical HoD','hod',2,45,'private password');
        """)
        self.db.executescript("""
            CREATE TABLE custom_departments(id INTEGER,name TEXT,institution_id INTEGER,hod_user_id INTEGER);
            INSERT INTO custom_departments VALUES(1000,'Cardiac Care Technology',7,NULL);
            CREATE TABLE portal_users(id INTEGER,username TEXT,name TEXT,role TEXT,campus_id INTEGER,department_id INTEGER,password_hash TEXT);
            INSERT INTO portal_users VALUES(10001,'cardiac-hod','Cardiac HoD','hod',2,NULL,'private hash');
            CREATE TABLE user_credentials(user_id INTEGER,must_change_password INTEGER);
        """)
    def inspect(self):
        self.output = io.StringIO()
        with contextlib.redirect_stdout(self.output):
            return diagnosis.diagnose(self.db, self.source)
    def test_missing_cardiac_assignment_and_duplicate_clinical_faculty_are_reported_without_secrets(self):
        rows = self.inspect()
        self.assertEqual([r['id'] for r in rows], [105,45,1000])
        self.assertIn('No HoD account is assigned', rows[-1]['mapping_issue'])
        self.assertNotIn('private password', self.output.getvalue())
        self.assertNotIn('private hash', self.output.getvalue())
        self.assertIn('cardiac-hod', self.output.getvalue())
    def test_valid_assignment_is_not_reported_as_a_failure(self):
        self.db.execute('UPDATE custom_departments SET hod_user_id=10001')
        cardiac = self.inspect()[-1]
        self.assertIsNone(cardiac['mapping_issue'])
        self.assertEqual(cardiac['hod']['username'], 'cardiac-hod')
    def test_temporary_password_and_wrong_campus_are_distinguished(self):
        self.db.execute('UPDATE custom_departments SET hod_user_id=10001')
        self.db.execute('INSERT INTO user_credentials VALUES(10001,1)')
        self.assertIn('Temporary password', self.inspect()[-1]['mapping_issue'])
        self.db.execute('UPDATE portal_users SET campus_id=1')
        self.assertIn('not a Trichy HoD', self.inspect()[-1]['mapping_issue'])
    def test_diagnosis_does_not_change_either_database(self):
        before = (list(self.source.iterdump()), list(self.db.iterdump()))
        self.inspect()
        self.assertEqual(before, (list(self.source.iterdump()), list(self.db.iterdump())))


if __name__ == '__main__':
    unittest.main()
