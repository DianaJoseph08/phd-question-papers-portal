// End-to-end tests use an isolated database and synthetic accounts only.
const assert=require('node:assert/strict'),sqlite=require('sqlite3'),path=require('path'),fs=require('fs'),Zip=require('pizzip'),{spawn}=require('child_process');
const {inspect}=require('./papers');
const parent=path.resolve(__dirname,'data','test-runs');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'submission-'));
const sourceFile=path.join(dir,'admissions.db');let server,base;
const run=(db,sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
const close=db=>new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));
async function request(cookie,url,body){const r=await fetch(base+'/api'+url,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});return {status:r.status,data:(r.headers.get('content-type')||'').includes('json')?await r.json():Buffer.from(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function login(username,password='fixture-password'){const r=await request('','/login',{username,password});assert.equal(r.status,200,JSON.stringify(r.data));return r.cookie;}
function fixture(prefix,{research=false,full=false,repeat=0,researchRepeat=repeat,invalid=false,count=25,rephrased=false,heading}={}){
 const p=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;let body='';
 for(const section of full?['Research Methodology','Subject-Specific Questions']:[research?'Research Methodology':heading||'Subject-Specific Questions']){
  const repeats=section==='Research Methodology'?researchRepeat:repeat;
  body+=p(section);for(let i=1;i<=count;i++)body+=p(`${i}. ${rephrased?`What result follows with sample ${i} from experiment ${i<=repeats?101:prefix}?`:`Which result follows from experiment ${i<=repeats?101:prefix} with sample ${i}?`} A) alpha ${invalid?'':'B) beta'} C) gamma D) delta`);
 }
 body+=p('Answer Key');for(let i=1;i<=count*(full?2:1);i++)body+=p(i+' '+['A','B','C','D'][(i-1)%4]);const z=new Zip();z.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);return z.generate({type:'nodebuffer'});
}
async function upload(cookie,department,set,buffer,archive=false,name='fixture.docx',note=''){const f=new FormData();for(const [k,v] of Object.entries({department_id:department,set_name:set,session:archive?'January 2026':'January 2027',kind:archive?'archive':'submission'}))f.set(k,v);f.set('file',new Blob([buffer]),name);f.set('note',note);return request(cookie,'/papers',f);}
async function startServer(port){
 base='http://127.0.0.1:'+port;
 server=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ADMISSIONS_DB:sourceFile,QUESTION_PAPER_DATA_DIR:path.join(dir,'app')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='';server.stderr.on('data',b=>logs+=b);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test server startup timed out: '+logs)),15000);server.stdout.on('data',b=>{if(String(b).includes('Question paper app:')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);reject(Error('Test server exited: '+code+' '+logs));});});
}
(async()=>{
 try{
  const db=new sqlite.Database(sourceFile);
  await run(db,'CREATE TABLE campuses(id INTEGER,name TEXT)');await run(db,'CREATE TABLE institutions(id INTEGER,name TEXT,campus_id INTEGER)');await run(db,'CREATE TABLE departments(id INTEGER,name TEXT,institution_id INTEGER)');await run(db,'CREATE TABLE users(id INTEGER,username TEXT,password TEXT,name TEXT,role TEXT,campus_id INTEGER,department_id INTEGER,email TEXT)');
  for(const row of [[1,'Ramapuram'],[2,'Trichy']])await run(db,'INSERT INTO campuses VALUES (?,?)',row);
  for(const row of [[1,'Faculty of Engineering and Technology',1],[2,'College of Engineering and Technology',2],[3,'Faculty of Science and Humanities',1],[4,'College of Science and Humanities',2],[5,'College of Allied Health Sciences',2],[6,'College of Occupational Therapy',2],[7,'College of Management',2]])await run(db,'INSERT INTO institutions VALUES (?,?,?)',row);
  for(const row of [[1,'Mechanical Engineering',1],[30,'Mechanical Engineering',2],[13,'Mathematics',3],[14,'Cybersecurity',1],[38,'Commerce',4],[44,'Medical Imaging Technology',5],[43,'Occupational Therapy',6],[102,'Management Studies',7]])await run(db,'INSERT INTO departments VALUES (?,?,?)',row);
  for(const u of [[1,'admin','admin',1,null],[2,'suresh','admin',1,null],[3,'ruby','admin',2,null],[5,'vani','coordinator',1,null],[8,'infant','coordinator',2,null],[10,'rmp-hod','hod',1,1],[11,'try-hod','hod',2,30],[12,'math-hod','hod',1,13],[13,'commerce-hod','hod',2,38],[14,'health-hod','hod',2,44],[15,'ot-hod','hod',2,43],[16,'management-hod','hod',2,102],[17,'dean','dean',1,null],[18,'other-coordinator','coordinator',1,null],[19,'cyber-hod','hod',1,14],[20,'super','super_admin',null,null]])await run(db,'INSERT INTO users VALUES (?,?,?,?,?,?,?,?)',[u[0],u[1],'fixture-password',u[1],...u.slice(2),u[1]+'@example.test']);
  await close(db);
  const accountSnapshot=fs.readFileSync(sourceFile);
  // Pick an available local test port, leaving the real application untouched.
  const net=require('net'),probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));base='http://127.0.0.1:'+port;
  await startServer(port);
  const health=await fetch(base+'/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true});
  const ac=await login('admin'),hc=await login('rmp-hod'),tc=await login('try-hod'),vc=await login('vani'),ic=await login('infant'),mc=await login('math-hod');
  assert.equal((await request('','/state')).status,401);assert.equal((await request(hc,'/inventory')).status,403);
  const state=(await request(hc,'/state')).data;assert.deepEqual(state.departments.map(d=>d.id),[1]);assert.equal(state.departments[0].common_rm_id,201);
  assert.deepEqual((await request(ic,'/state')).data.departments.map(d=>d.id).sort((a,b)=>a-b),[-204,-203,202]);
  assert.equal((await upload(ac,1,'A',fixture(200))).status,400);
  assert.equal((await upload(hc,1,'A',fixture(101),true)).status,400);
  assert.equal((await upload(hc,201,'A',fixture(200,{research:true}))).status,400);
  assert.equal((await upload(vc,202,'A',fixture(200,{research:true}))).status,400);
  assert.equal((await upload(mc,13,'A',fixture(200))).status,200,'Count mismatch is advisory for uploads');
  // A named Set B must not hide the coordinator's Set A when the wrong dropdown is selected.
  const commonA=await upload(vc,201,'A',fixture(5100,{research:true}),false,'Rmp_All Department _Jan_2027_QP_Set_A.docx');assert.equal(commonA.status,200);
  const wrongSet=await upload(vc,201,'A',fixture(5200,{research:true}),false,'Rmp_All Department _Jan_2027_QP_Set_B.docx');assert.equal(wrongSet.status,422);assert.equal(wrongSet.data.expected_set,'B');
  const preserved=(await request(vc,'/state')).data.papers.filter(p=>p.kind==='submission');assert.equal(preserved.length,1);assert.equal(preserved[0].id,commonA.data.id);
  let commonB;for(const prefix of [5200,5300]){commonB=await upload(vc,201,'B',fixture(prefix,{research:true}),false,'Rmp_All Department _Jan_2027_QP_Set_B.docx');assert.equal(commonB.status,200);}
  const both=(await request(vc,'/state')).data.papers.filter(p=>p.kind==='submission');assert.equal(both.length,2);assert.equal(both.find(p=>p.set_name==='A').id,commonA.data.id);assert.equal(both.find(p=>p.set_name==='B').id,commonB.data.id);
  // No archives: accept a fresh valid subject paper, with an explicit review warning.
  const accepted=await upload(hc,1,'A',fixture(200));assert.equal(accepted.status,200,JSON.stringify(accepted.data));assert.equal(accepted.data.screening.matched_count,0);assert.equal(accepted.data.screening.coverage.complete,false);assert.ok(accepted.data.screening.warning);assert.equal(accepted.data.screening.template.passed,true);
  assert.deepEqual(accepted.data.counts,{research:0,subject:25});
  assert.equal((await request(hc,`/papers/${accepted.data.id}/download`)).status,200);
  assert.equal((await request(tc,`/papers/${accepted.data.id}/download`)).status,404);
  const before=(await request(hc,'/state')).data.papers.find(p=>p.kind==='submission').id;
  const malformed=await upload(hc,1,'A',fixture(200,{invalid:true}),false,'fixture.docx','Please check the option formatting.');assert.equal(malformed.status,200,JSON.stringify(malformed.data));assert.equal(malformed.data.screening.matched_count,0);assert.equal(malformed.data.screening.template.passed,true);assert.notEqual((await request(hc,'/state')).data.papers.find(p=>p.kind==='submission').id,before);
  const formattingPreview=await request(ac,`/papers/${malformed.data.id}/preview`);assert.equal(formattingPreview.status,200);assert.equal(formattingPreview.data.template.passed,true);assert.equal(formattingPreview.data.template.option_errors.length,25);assert.equal(formattingPreview.data.template.option_errors[0].missing,'B');assert.equal(formattingPreview.data.template.option_errors[0].section,'subject');assert.equal(formattingPreview.data.screening.template.option_errors[0].missing,'B');
  assert.equal((await request(ac,`/papers/${malformed.data.id}/review`,{})).status,200,'Formatting remarks must not block admin approval');assert.equal((await request(ac,`/papers/${malformed.data.id}/preview`)).data.screening.submission_note,'Please check the option formatting.');
  const archive=await upload(ac,1,'A',fixture(101),true);assert.equal(archive.status,200);
  for(const n of [10,11]){const result=await upload(hc,1,'A',fixture(200,{repeat:n}));assert.equal(result.status,n===10?200:422,JSON.stringify(result.data));assert.equal(result.data.screening.matched_count,n);if(n===11){assert.ok(result.data.screening.matches.every(m=>m.past_file==='fixture.docx'&&m.past_session==='January 2026'));assert.equal(result.data.id,undefined);}}
  // Trichy must screen the same cross-campus archive as Ramapuram, with formatting nonblocking.
  for(const n of [10,11]){
   const result=await upload(tc,30,'A',fixture(200,{repeat:n,invalid:true,rephrased:true}));assert.equal(result.status,n===10?200:422,JSON.stringify(result.data));assert.equal(result.data.screening.matched_count,n);
   assert.ok(result.data.screening.matches.every(m=>m.type==='Possible rephrasing'&&m.past_campus==='Ramapuram'));
  }
  // Count corrections must never hide the repetition table, including a no-match count error.
  for(const [n,cookie,d] of [[11,tc,30],[1,tc,30],[0,tc,30],[0,hc,1]]){
   const result=await upload(cookie,d,'B',fixture(999,{repeat:n,count:24,invalid:true}));assert.equal(result.status,n>10?422:200);assert.equal(result.data.screening.matched_count,n);assert.equal(result.data.screening.template.passed,false);assert.equal(result.data.screening.template.counts.subject,24);
   assert.equal(result.data.screening.rejected,n>10);assert.equal(Boolean(result.data.id),n<=10);
  }
  const facultyCases=[[38,'commerce-hod',-203,'Commerce'],[44,'health-hod',-204,'Medical Imaging Technology'],[43,'ot-hod',-204,'Occupational Therapy'],[102,'management-hod',null,'Management Studies']];
  for(const [d,user,common,name] of facultyCases){
   const cookie=await login(user),scoped=(await request(cookie,'/state')).data;assert.equal(scoped.departments[0].common_rm_id,common);
   const full=!common;
   // Existing Mechanical archives must not be mistaken for this department's archives.
   const isolated=await upload(cookie,d,'A',fixture(101,{full,heading:name+' Questions'}));assert.equal(isolated.status,200);assert.equal(isolated.data.screening.matched_count,0);
   assert.equal((await upload(ac,d,'A',fixture(101),true)).status,200);
   for(const n of [0,10,11]){
    const result=await upload(cookie,d,'B',fixture(999,{full,repeat:n,researchRepeat:0,invalid:true,heading:name+' Questions'}));
    assert.equal(result.status,n>10?422:200,JSON.stringify(result.data));assert.equal(result.data.screening.matched_count,n);assert.equal(result.data.screening.template.passed,true);
    if(n)assert.ok(result.data.screening.matches.every(m=>m.past_campus==='Trichy'));
   }
   const countError=await upload(cookie,d,'A',fixture(999,{full,count:24,repeat:11}));assert.equal(countError.status,422);assert.equal(countError.data.screening.template.passed,false);assert.ok(countError.data.screening.matches.length);
  }
  // Infant's three Common RM categories use the same threshold and stay isolated by faculty.
  for(const d of [202,-203,-204]){
   const fresh=await upload(ic,d,'A',fixture(101,{research:true,invalid:true}));assert.equal(fresh.status,200);assert.equal(fresh.data.screening.matched_count,0);
   assert.equal((await upload(ac,d,'A',fixture(101,{research:true}),true)).status,200);
   for(const n of [0,10,11]){const result=await upload(ic,d,'B',fixture(999,{research:true,repeat:n,rephrased:true,invalid:true}));assert.equal(result.status,n>10?422:200,JSON.stringify(result.data));assert.equal(result.data.screening.matched_count,n);}
  }
  // Approval and generation must recheck newly added archives with the same match report.
  const commerce=await login('commerce-hod');let commerceA;
  for(const set of ['A','B']){const saved=await upload(commerce,38,set,fixture(8800));assert.equal(saved.status,200);assert.equal((await request(ac,`/papers/${saved.data.id}/review`,{})).status,200);if(set==='A')commerceA=saved.data.id;}
  assert.equal((await upload(ac,38,'B',fixture(8800),true)).status,200);
  for(const result of [await request(ac,`/papers/${commerceA}/review`,{}),await request(ac,'/generate',{department_id:38,set_name:'A'})]){assert.equal(result.status,422);assert.equal(result.data.screening.matched_count,25);assert.ok(result.data.screening.matches.every(m=>m.past_campus==='Trichy'&&m.past_set==='B'));}
  // Valid, fresh subject-only sets are approvable before the coordinator supplies RM.
  for(const [department,cookie,prefix] of [[1,hc,1000],[30,tc,2000]])for(const [index,set] of ['A','B'].entries()){
   const result=await upload(cookie,department,set,fixture(prefix+index));assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.screening.matched_count,0);assert.equal((await request(cookie,`/papers/${result.data.id}/review`,{})).status,403);assert.equal((await request(ac,`/papers/${result.data.id}/review`,{})).status,200);
  }
  const waiting=await request(ac,'/generate',{department_id:1,set_name:'A'});assert.equal(waiting.status,400);assert.match(waiting.data.error,/Common Research Methodology/);
  for(const [department,cookie,prefix] of [[201,vc,3000],[202,ic,4000]])for(const [index,set] of ['A','B'].entries()){
   const result=await upload(cookie,department,set,fixture(prefix+index,{research:true}));assert.equal(result.status,200,JSON.stringify(result.data));assert.equal((await request(ac,`/papers/${result.data.id}/review`,{})).status,200);
  }
  // A restored Linux/Windows deployment must not depend on the original PC path.
  const relocated=new sqlite.Database(path.join(dir,'app','papers.db'));
  const rows=await new Promise((resolve,reject)=>relocated.all('SELECT id,path FROM papers',(e,r)=>e?reject(e):resolve(r)));
  for(const row of rows)await run(relocated,'UPDATE papers SET path=? WHERE id=?',['Z:\\retired-machine\\files\\'+path.basename(row.path),row.id]);
  await close(relocated);
  assert.equal((await request(ac,`/papers/${archive.data.id}/download`)).status,200);
  assert.equal((await request(hc,'/storage-status')).status,403);
  assert.equal((await request(ac,'/storage-status')).data.mode,'local');
  const allHashes=new Set();
  for(const set_name of ['A','B']){
   const result=await request(ac,'/generate',{department_id:1,set_name});assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual(result.data.distribution,{Ramapuram:25,Trichy:25});assert.equal(result.data.question_count,50);assert.equal(result.data.common_rm.length,2);
   const manifest=(await request(ac,`/generations/${result.data.id}/manifest`)).data;
   assert.equal(manifest.questions.length,50);assert.equal(manifest.questions.filter(q=>q.section==='research').length,25);
   for(const q of manifest.questions){assert.ok(!allHashes.has(q.hash));allHashes.add(q.hash);assert.ok((q.section==='research'?[201,202]:[1,30]).includes(q.department_id));}
   for(const d of [1,30,201,202])for(const s of ['A','B'])assert.ok(manifest.questions.some(q=>q.department_id===d&&q.source_set===s));
   const download=await request(ac,`/generations/${result.data.id}/download`);assert.equal(download.status,200);const output=inspect(download.data);assert.equal(output.questions.length,50);assert.deepEqual(output.questions.map(q=>q.answer),manifest.questions.map(q=>q.answer));for(const q of manifest.questions)assert.equal(q.answer,['A','B','C','D'][(q.source_question_number-1)%4]);
   assert.equal((await request(hc,`/generations/${result.data.id}/download`)).status,403);
  }
  // Named administrators can add departments, archive their papers and assign existing HoDs.
  const sc=await login('suresh'),rc=await login('ruby');
  for(const cookie of [sc,rc]){const options=(await request(cookie,'/state')).data;assert.equal(options.can_manage_departments,true);assert.equal(options.institutions.length,7);assert.ok(options.hod_accounts.every(u=>!('password' in u)));}
  for(const cookie of [ac,hc,ic]){assert.equal((await request(cookie,'/departments',{name:'Unauthorized',institution_id:1})).status,403);assert.deepEqual((await request(cookie,'/state')).data.hod_accounts,[]);}
  const createdAccounts=[];
  for(const [cookie,campus,institution] of [[sc,1,1],[rc,2,2]]){
   const new_hod={name:'New HoD '+campus,username:'new-hod-'+campus,email:'new'+campus+'@example.test',new_password:'Temporary new-HoD password!',confirm_password:'Temporary new-HoD password!'};
   const rollback=await request(cookie,'/departments',{name:'Invalid faculty',campus_id:campus,institution_id:999,new_hod});assert.equal(rollback.status,400);assert.ok(!(await request(cookie,'/users')).data.users.some(u=>u.username===new_hod.username));
   const added=await request(cookie,'/departments',{name:'New Specialism '+campus,campus_id:campus,institution_id:institution,new_hod});assert.equal(added.status,201,JSON.stringify(added.data));createdAccounts.push({new_hod,id:added.data.department.id});
   assert.equal((await request(cookie,'/departments',{name:'Another '+campus,campus_id:campus,institution_id:institution,new_hod:{...new_hod,username:new_hod.username.toUpperCase()}})).status,409);
   const temporary=await login(new_hod.username,new_hod.new_password);assert.equal((await request(temporary,'/state')).data.user.must_change_password,true);assert.equal((await upload(temporary,added.data.department.id,'A',fixture(90000))).status,403);
   const password='Changed new-HoD password!';assert.equal((await request(temporary,'/password',{current_password:new_hod.new_password,new_password:password,confirm_password:password})).status,200);
   const own=(await request(temporary,'/state')).data;assert.deepEqual(own.departments.map(d=>d.id),[added.data.department.id]);assert.equal(own.departments[0].campus_id,campus);
   const paper=await upload(temporary,added.data.department.id,'A',fixture(92000,{count:24,invalid:true}),false,'fixture.docx','Template mismatch supplied for admin review.');assert.equal(paper.status,200);assert.equal(paper.data.screening.template.passed,false);assert.equal((await request(cookie,`/papers/${paper.data.id}/review`,{})).status,200);
   const viewed=(await request(cookie,`/papers/${paper.data.id}/preview`)).data;assert.equal(viewed.screening.submission_note,'Template mismatch supplied for admin review.');const b=await upload(temporary,added.data.department.id,'B',fixture(93000));assert.equal(b.status,200);assert.equal((await request(cookie,`/papers/${b.data.id}/review`,{})).status,200);const cannotGenerate=await request(cookie,'/generate',{department_id:added.data.department.id,set_name:'A'});assert.equal(cannotGenerate.status,422);assert.ok(cannotGenerate.data.generation_issues.some(i=>/Read 0 RM \/ 24 subject/.test(i.remark)));
  }
  const newRmp=await request(sc,'/departments',{name:' Civil   Engineering ',campus_id:1,institution_id:1,hod_user_id:10});assert.equal(newRmp.status,201,JSON.stringify(newRmp.data));assert.equal(newRmp.data.department.name,'Civil Engineering');assert.equal(newRmp.data.department.common_rm_id,201);
  const newTry=await request(rc,'/departments',{name:'Civil Engineering',campus_id:2,institution_id:2,hod_user_id:11,common_rm_id:201});assert.equal(newTry.status,201);assert.equal(newTry.data.department.common_rm_id,202,'Coordinator cannot be overridden across campuses');
  assert.equal((await request(rc,'/departments',{name:'civil engineering',institution_id:1})).status,409);
  for(const body of [{name:' ',institution_id:1},{name:'A'.repeat(121),institution_id:1},{name:'Unknown faculty',institution_id:999},{name:'Wrong campus',campus_id:1,institution_id:2},{name:'Wrong HoD',institution_id:2,hod_user_id:10},{name:'Admin as HoD',institution_id:1,hod_user_id:2},{name:'Common Research Methodology',institution_id:1}])assert.equal((await request(sc,'/departments',body)).status,400);
  const unassigned=await request(rc,'/departments',{name:'Biostatistics',institution_id:4});assert.equal(unassigned.status,201);assert.equal(unassigned.data.department.common_rm_id,-203);
  assert.equal((await upload(rc,unassigned.data.department.id,'A',fixture(101),true)).status,200);assert.equal((await upload(tc,unassigned.data.department.id,'A',fixture(70000))).status,400);
  const rmpId=newRmp.data.department.id,tryId=newTry.data.department.id;
  assert.ok((await request(hc,'/state')).data.departments.some(d=>d.id===rmpId));assert.ok(!(await request(tc,'/state')).data.departments.some(d=>d.id===rmpId));
  for(const [d,adminCookie,hodCookie,prefix] of [[rmpId,rc,hc,50000],[tryId,sc,tc,60000]]){
   const past=await upload(adminCookie,d,'A',fixture(101),true);assert.equal(past.status,200);assert.equal((await request(d===rmpId?tc:hc,`/papers/${past.data.id}/download`)).status,404);
   const repeated=await upload(hodCookie,d,'A',fixture(prefix,{repeat:11}));assert.equal(repeated.status,422);assert.equal(repeated.data.screening.matched_count,11);
   for(const [index,set] of ['A','B'].entries()){const fresh=await upload(hodCookie,d,set,fixture(prefix+index));assert.equal(fresh.status,200);assert.equal((await request(sc,`/papers/${fresh.data.id}/review`,{})).status,200);}
  }
  const civilHashes=new Set();
  for(const set_name of ['A','B']){
   const newFinal=await request(rc,'/generate',{department_id:rmpId,set_name});assert.equal(newFinal.status,200,JSON.stringify(newFinal.data));assert.deepEqual(newFinal.data.distribution,{Ramapuram:25,Trichy:25});
   const manifest=(await request(rc,`/generations/${newFinal.data.id}/manifest`)).data;
   for(const q of manifest.questions){assert.ok(!civilHashes.has(q.hash));civilHashes.add(q.hash);}
   for(const d of [rmpId,tryId,201,202])for(const s of ['A','B'])assert.ok(manifest.questions.some(q=>q.department_id===d&&q.source_set===s));
  }
  // A new department on the other campus must group with the existing admissions department.
  const newCyber=await request(rc,'/departments',{name:'Cybersecurity',institution_id:2,hod_user_id:11});assert.equal(newCyber.status,201);const cyberId=newCyber.data.department.id,cyber=await login('cyber-hod');
  for(const [d,cookie,prefix] of [[14,cyber,70000],[cyberId,tc,80000]])for(const [index,set] of ['A','B'].entries()){
   let source=fixture(prefix+index,{full:d===14});if(d===14){const zip=new Zip(source);zip.file('word/document.xml',zip.file('word/document.xml').asText().replace(/<w:p><w:r><w:t>(\d+) [ABCD]<\/w:t><\/w:r><\/w:p>/g,(m,n)=>Number(n)<=25?'':m));source=zip.generate({type:'nodebuffer'});}const fresh=await upload(cookie,d,set,source);assert.equal(fresh.status,200);assert.equal((await request(sc,`/papers/${fresh.data.id}/review`,{})).status,200);
  }
  for(const set_name of ['A','B']){
   const final=await request(sc,'/generate',{department_id:14,set_name});assert.equal(final.status,200,JSON.stringify(final.data));assert.deepEqual(final.data.distribution,{Ramapuram:25,Trichy:25});
   const manifest=(await request(sc,`/generations/${final.data.id}/manifest`)).data;
   assert.ok(manifest.questions.filter(q=>q.section==='research').every(q=>[201,202].includes(q.department_id)),'Assigned Common RM must replace a full HoD paper’s own RM');for(const d of [14,cyberId,201,202])for(const s of ['A','B'])assert.ok(manifest.questions.some(q=>q.department_id===d&&q.source_set===s));
  }
  // Remove the latest archive without resurrecting the previous version or using it in screening.
  const removed=await upload(rc,unassigned.data.department.id,'A',fixture(202),true,'latest-archive.docx');assert.equal(removed.status,200);
  assert.equal((await request(tc,`/papers/${removed.data.id}/remove`,{reason:'Wrong assignment'})).status,403);
  assert.equal((await request(rc,`/papers/${removed.data.id}/remove`,{reason:'x'})).status,400);
  assert.equal((await request(rc,`/papers/${removed.data.id}/remove`,{reason:'Incorrect test archive'})).status,200);
  assert.ok(!(await request(rc,'/state')).data.papers.some(p=>p.department_id===unassigned.data.department.id));assert.equal((await request(rc,`/papers/${removed.data.id}/download`)).status,404);
  const removedSubmission=(await request(cyber,'/state')).data.papers.find(p=>p.department_id===14&&p.set_name==='B');
  assert.equal((await request(sc,`/papers/${removedSubmission.id}/remove`,{reason:'Invalid source'})).status,200);assert.equal((await request(sc,'/generate',{department_id:14,set_name:'A'})).status,400);
  // All account holders may change passwords, but usernames and private admin pages remain protected.
  for(const cookie of [hc,tc,vc,ic,await login('dean'),await login('other-coordinator')])for(const url of ['/users','/audit'])assert.equal((await request(cookie,url)).status,403);
  for(const username of ['dean','other-coordinator']){
   const cookie=await login(username),s=(await request(cookie,'/state')).data;assert.equal(s.can_use_papers,false);assert.deepEqual(s.templates,[]);assert.deepEqual(s.papers,[]);assert.equal((await request(cookie,'/templates/A')).status,403);
   assert.equal((await request(cookie,'/password',{current_password:'fixture-password',new_password:'new-private-password',confirm_password:'new-private-password'})).status,200);assert.equal((await request(cookie,'/state')).status,200);
  }
  const directory=(await request(sc,'/users')).data.users;assert.ok(directory.every(u=>!('password' in u)&&!('password_hash' in u)));assert.equal(directory.find(u=>u.id===10).email,'rmp-hod@example.test');
  const otherHodSession=await login('rmp-hod'),hodPassword='new-rmp-password',change={current_password:'fixture-password',new_password:hodPassword,confirm_password:hodPassword};
  assert.equal((await request(hc,'/password',{...change,username:'replacement'})).status,400);assert.equal((await request(hc,'/password',{...change,current_password:'incorrect'})).status,400);
  assert.equal((await request(hc,'/password',change)).status,200);assert.equal((await request(hc,'/state')).status,200);assert.equal((await request(otherHodSession,'/state')).status,401);
  assert.equal((await request('','/login',{username:'rmp-hod',password:'fixture-password'})).status,401);await login('rmp-hod',hodPassword);
  const reset={current_password:'fixture-password',new_password:'temporary-try-password',confirm_password:'temporary-try-password'};
  assert.equal((await request(sc,'/users/20/reset-password',reset)).status,403);assert.equal((await request(hc,'/users/11/reset-password',reset)).status,403);assert.equal((await request(sc,'/users/11/reset-password',{...reset,current_password:'incorrect'})).status,400);
  assert.equal((await request(sc,'/users/11/reset-password',reset)).status,200);assert.equal((await request(tc,'/state')).status,401);
  const temporary=await login('try-hod',reset.new_password),temporaryState=(await request(temporary,'/state')).data;assert.equal(temporaryState.user.must_change_password,true);assert.deepEqual(temporaryState.papers,[]);assert.deepEqual(temporaryState.templates,[]);assert.equal((await upload(temporary,tryId,'A',fixture(90000))).status,403);assert.equal((await request(temporary,'/templates/A')).status,403);
  const tryPassword='new-try-password';assert.equal((await request(temporary,'/password',{current_password:reset.new_password,new_password:tryPassword,confirm_password:tryPassword})).status,200);assert.equal((await request(temporary,'/state')).data.user.must_change_password,false);
  const events=(await request(sc,'/audit?limit=100')).data;assert.ok(events.total>events.events.length);assert.ok(events.events.some(e=>e.action==='paper.removed'&&e.actor_username==='ruby'&&e.details.reason==='Incorrect test archive'));
  for(const action of ['paper.uploaded','paper.replaced','paper.rejected','paper.approved','paper.generated','department.added','account.added','account.password_changed','account.password_reset'])assert.ok((await request(rc,'/audit?action='+action)).data.total>0,action);
  const uploadLogs=(await request(sc,'/audit?search=latest-archive.docx')).data.events;assert.ok(uploadLogs.some(e=>e.action==='paper.replaced'&&e.actor_username==='ruby'&&e.created_at));
  for(const secret of [hodPassword,tryPassword,reset.new_password,'fixture-password'])assert.ok(!JSON.stringify(events).includes(secret));
  assert.equal((await request(sc,'/users')).data.users.find(u=>u.id===11).password_status,'Changed securely');
  // A restart must retain new department assignments and uploaded archive metadata.
  await new Promise(resolve=>{server.once('exit',resolve);server.kill();});await startServer(port);
  const restartedAdmin=await login('ruby'),restarted=(await request(restartedAdmin,'/state')).data;assert.equal(restarted.departments.filter(d=>d.is_custom).length,6);assert.ok(restarted.papers.some(p=>p.department_id===rmpId&&p.kind==='archive'));assert.ok(!restarted.papers.some(p=>p.department_id===unassigned.data.department.id));assert.ok((await request(await login('rmp-hod',hodPassword),'/state')).data.departments.some(d=>d.id===rmpId));await login('try-hod',tryPassword);assert.ok((await request(restartedAdmin,'/audit?action=account.password_reset')).data.total>0);assert.equal((await request(restartedAdmin,'/users')).data.users.find(u=>u.id===10).password_status,'Changed securely');for(const account of createdAccounts)assert.deepEqual((await request(await login(account.new_hod.username,'Changed new-HoD password!'),'/state')).data.departments.map(d=>d.id),[account.id]);assert.deepEqual(fs.readFileSync(sourceFile),accountSnapshot,'Admissions accounts must remain unchanged');
  console.log('Integration passed: both-campus screening and generation, new/existing department grouping, admin-only activity/account pages, paper removal, password changes/resets, session revocation, immutable usernames, restart persistence and unchanged admissions database. Real app data was not changed.');
  if(process.argv.includes('--ui')){console.log('UI fixture available: '+base+' (use ruby / fixture-password). Send a newline to end.');await new Promise(resolve=>process.stdin.once('data',resolve));}
 }finally{
  if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});
  const resolved=path.resolve(dir);if(!resolved.startsWith(parent+path.sep))throw Error('Unsafe test cleanup path');fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
