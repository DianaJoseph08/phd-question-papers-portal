const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {Accounts,hashPassword,verifyHash,validateNewPassword}=require('./accounts');
const {Audit,redact}=require('./audit');
const {open,close,all,run}=require('./persistent-data');
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qp-account-test-')),db=await open(path.join(dir,'test.db'));
 t.after(async()=>{await close(db);const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});});
 const users=[{id:1,username:'suresh',name:'Admin',role:'admin',password:'old-fixture-password',email:'admin@example.test',campus_id:1},{id:2,username:'hod',name:'HoD',role:'hod',password:'old-fixture-password',email:'hod@example.test',campus_id:1}];
 const accounts=new Accounts({db:()=>db,users}),audit=new Audit({db:()=>db,users});await accounts.ensure();await audit.ensure();return {accounts,audit,db};
}
test('password hashing uses independent salts, preserves spaces and verifies safely',async()=>{
 const password=' A strong fixture password! ',a=await hashPassword(password),b=await hashPassword(password);assert.notEqual(a,b);assert.equal(await verifyHash(password,a),true);assert.equal(await verifyHash(password.trim(),a),false);assert.equal(await verifyHash(password,'invalid'),false);
});
test('password overlays supersede original passwords without exposing hashes or changing usernames',async t=>{
 const {accounts}=await setup(t);const old=await accounts.authenticate('HOD','old-fixture-password');assert.equal(old.version,0);assert.equal('password' in old.user,false);
 const version=await accounts.setPassword(2,'Changed fixture password!',2);assert.equal(await accounts.authenticate('hod','old-fixture-password'),null);assert.equal(await accounts.validSession(2,0),false);assert.equal(await accounts.validSession(2,version),true);
 const fresh=await accounts.authenticate('hod','Changed fixture password!');assert.equal(fresh.user.username,'hod');assert.equal(fresh.user.must_change_password,false);
 const directory=await accounts.list([]);assert.ok(directory.every(u=>!('password' in u)&&!('password_hash' in u)));assert.equal(directory[1].password_status,'Changed securely');assert.equal(directory[1].email,'hod@example.test');
 await accounts.setPassword(2,'Temporary fixture password!',1,true);assert.equal((await accounts.authenticate('hod','Temporary fixture password!')).user.must_change_password,true);
});
test('password updates reject username changes, short passwords and mismatched confirmation',()=>{
 for(const body of [{new_password:'short',confirm_password:'short'},{new_password:'Long enough password!',confirm_password:'different'},{username:'renamed',new_password:'Long enough password!',confirm_password:'Long enough password!'}])assert.throws(()=>validateNewPassword(body));
});
test('audit logs redact secrets and support literal search and pagination',async t=>{
 const {audit,db}=await setup(t),actor={id:1,username:'suresh',name:'Admin'};
 await audit.log(actor,'paper.uploaded','paper','one',{filename:'100%_paper.docx',password:'secret',nested:{token:'secret',value:'safe'}});
 await audit.log(actor,'paper.removed','paper','two',{reason:'Wrong set'});
 const stored=(await all(db,'SELECT details FROM audit_events'))[0].details;assert.ok(!stored.includes('secret'));assert.deepEqual(redact({password_hash:'hidden',username:'hod'}),{username:'hod'});
 assert.equal((await audit.list({search:'100%_'})).total,1);assert.equal((await audit.list({action:'paper.removed'})).events[0].target_id,'two');assert.equal((await audit.list({offset:1,limit:1})).events.length,1);
});
test('historical activity is backfilled once with its original actor and UTC timestamp',async t=>{
 const {audit,db}=await setup(t);
 await run(db,'CREATE TABLE papers(id TEXT,department_id INTEGER,campus_id INTEGER,session TEXT,set_name TEXT,kind TEXT,original_name TEXT,uploaded_by INTEGER,created_at TEXT)');
 await run(db,"INSERT INTO papers VALUES ('past',1,1,'January 2026','A','archive','past.docx',2,'2026-01-10 05:00:00')");
 await run(db,'CREATE TABLE custom_departments(id INTEGER,name TEXT,institution_id INTEGER,hod_user_id INTEGER,created_by INTEGER,created_at TEXT)');
 await run(db,"INSERT INTO custom_departments VALUES (1000,'Physics',1,2,1,'2026-10-10T04:00:00.000Z')");
 await audit.bootstrap();await audit.bootstrap();const result=await audit.list();assert.equal(result.total,2);
 const paper=result.events.find(e=>e.target_type==='paper');assert.equal(paper.actor_username,'hod');assert.equal(paper.created_at,'2026-01-10T05:00:00.000Z');assert.equal(paper.details.historical,true);
});
