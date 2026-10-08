const express=require('express'), multer=require('multer'), sqlite=require('sqlite3'), fs=require('fs'), path=require('path'), crypto=require('crypto');
const {inspect,choose,generate}=require('./papers');
const {screen,departmentKey}=require('./screening');
const {commonFor,inspectForDepartment,validateTemplate}=require('./submission-policy');
const {setFromFilename}=require('./public/upload-set');
const root=__dirname, data=process.env.QUESTION_PAPER_DATA_DIR||path.join(root,'data'), parent=path.dirname(root);
fs.mkdirSync(path.join(data,'files'),{recursive:true});
const source=new sqlite.Database(process.env.ADMISSIONS_DB||path.join(parent,'phd_admissions.db'),sqlite.OPEN_READONLY);
const db=new sqlite.Database(path.join(data,'papers.db'));
const all=(d,sql,args=[])=>new Promise((resolve,reject)=>d.all(sql,args,(e,r)=>e?reject(e):resolve(r)));
const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this)}));
const app=express(), sessions=new Map(), attempts=new Map();
if(process.env.TRUST_PROXY==='1'||process.env.TRUST_PROXY==='true')app.set('trust proxy',1);
app.disable('x-powered-by');app.use(express.json({limit:'1mb'}));
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');res.set('Cache-Control','no-store');res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'");if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('origin')&&req.get('origin')!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Cross-origin request refused.'});next();});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1}});
const {admin,scope,canSubmit}=require('./access');
let departments=[];
app.get('/healthz',(req,res)=>res.status(200).json({ok:true}));
app.post('/api/login',async(req,res)=>{
 const key=req.ip, history=(attempts.get(key)||[]).filter(t=>Date.now()-t<900000);attempts.set(key,history);
 if(history.length>=10)return res.status(429).json({error:'Too many login attempts. Try again in 15 minutes.'});
 history.push(Date.now());const rows=await all(source,'SELECT id,username,name,role,campus_id,department_id FROM users WHERE LOWER(username)=LOWER(?) AND password=?',[String(req.body.username||'').trim(),String(req.body.password||'').trim()]);
 const user=rows[0];if(!user||(!admin(user)&&user.role!=='hod'&&!departments.some(d=>d.is_common&&scope(user,d))))return res.status(401).json({error:'Invalid credentials or account does not have Admin/HoD/assigned coordinator access.'});
 attempts.delete(key);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{user,expires:Date.now()+8*3600000});
 res.cookie('qp_session',token,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:8*3600000});res.json({user});
});
app.use('/api',(req,res,next)=>{const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('qp_session='))?.slice(11);const s=sessions.get(token);if(!s||s.expires<Date.now()){sessions.delete(token);return res.status(401).json({error:'Please sign in.'});}req.user=s.user;req.token=token;next();});
app.post('/api/logout',(req,res)=>{sessions.delete(req.token);res.clearCookie('qp_session');res.json({ok:true});});
app.get('/api/state',async(req,res)=>{
 const rows=await all(db,`SELECT p.* FROM papers p WHERE NOT EXISTS (
  SELECT 1 FROM papers newer
  WHERE newer.department_id=p.department_id AND newer.campus_id=p.campus_id
   AND newer.session=p.session AND newer.set_name=p.set_name AND newer.kind=p.kind
   AND (newer.created_at>p.created_at OR (newer.created_at=p.created_at AND newer.rowid>p.rowid))
 ) ORDER BY p.created_at DESC,p.rowid DESC`);
 const visible=rows.filter(p=>scope(req.user,departments.find(d=>d.id===p.department_id)||{})&&(admin(req.user)||p.kind==='archive'||p.uploaded_by===req.user.id||req.user.role==='coordinator'));
 res.json({user:req.user,departments:admin(req.user)?departments:departments.filter(d=>scope(req.user,d)),papers:visible.map(({path:ignored,...p})=>p),templates:await all(db,'SELECT set_name,original_name,updated_at FROM templates'),generations:admin(req.user)?await all(db,'SELECT id,department_name,set_name,distribution,created_at FROM generations ORDER BY created_at DESC'):[]});
});
function requireAdmin(req,res,next){if(!admin(req.user))return res.status(403).json({error:'Administrator access required.'});next();}
function metadata(req){if(req.body.kind==='submission'&&admin(req.user))throw Error('Only HoDs and assigned research coordinators can submit January 2027 question papers.');const d=departments.find(d=>d.id===Number(req.body.department_id));if(!d||!scope(req.user,d))throw Error('Select an authorized department.');if(req.body.kind==='submission'&&!canSubmit(req.user,d))throw Error('Only the assigned HoD or research coordinator can submit this paper.');const {kind,session,set_name}=req.body;if(!['A','B'].includes(set_name))throw Error('Choose Set A or Set B.');if(kind==='archive'){if(!admin(req.user)||!['January 2026','July 2026'].includes(session))throw Error('Only administrators can upload 2026 papers.');}else if(kind!=='submission'||session!=='January 2027')throw Error('Select a valid session.');return d;}
async function screeningFor(department,info,set) {
 if(!info.valid){const error=Error('The question count or section format does not match the assigned paper type.');error.status=422;throw error;}
 const related=departments.filter(d=>departmentKey(d)===departmentKey(department));
 const rows=await all(db,"SELECT * FROM papers WHERE kind='archive' ORDER BY created_at DESC,rowid DESC");
 const latest=new Map();for(const p of rows)if(related.some(d=>d.id===p.department_id)){const key=p.department_id+'|'+p.session+'|'+p.set_name;if(!latest.has(key))latest.set(key,p);}
 const missing=[],archives=[];
 for(const d of related)for(const session of ['January 2026','July 2026'])for(const set_name of ['A','B']){
  const p=latest.get(d.id+'|'+session+'|'+set_name);
  if(!p){missing.push({campus:d.campus,session,set:set_name,reason:'Not uploaded'});continue;}
  let parsed;try{parsed=inspectForDepartment(fs.readFileSync(p.path),d);}catch(e){missing.push({campus:d.campus,session,set:set_name,reason:'Archive could not be read; administrator review is needed'});continue;}
  if(!parsed.valid)missing.push({campus:d.campus,session,set:set_name,reason:'Archive extraction is incomplete or uses a different historical format; readable questions were still checked'});
  if(parsed.questions.length)archives.push({...p,campus:d.campus,questions:parsed.questions.filter(q=>!/question\s+starts?\s+here/i.test(q.text))});
 }
 const report=screen(info.questions,archives,set);
 report.coverage={complete:missing.length===0,checked_papers:archives.length,checked_questions:archives.reduce((sum,p)=>sum+p.questions.length,0),issues:missing};
 if(missing.length)report.warning='Upload accepted for review; repeat checking used the readable archived questions only. Missing or incomplete archives need administrator review.';
 return report;
}
function rejectMatches(report){if(report.rejected){const e=Error('Upload rejected: '+report.matched_count+' questions match the past two sessions. The maximum allowed is 10. Revise the matched questions and upload again.');e.status=422;e.details={screening:report};throw e;}}
async function store(req,buffer,name){
 const d=metadata(req);if(!name.toLowerCase().endsWith('.docx'))throw Error('Only .docx Word documents are accepted.');
 const filenameSet=setFromFilename(name);
 if(req.body.kind==='submission'&&filenameSet&&filenameSet!==req.body.set_name){const e=Error('This filename identifies Set '+filenameSet+', but Set '+req.body.set_name+' is selected. Select Set '+filenameSet+' and upload again. Your existing papers have not been changed.');e.status=422;e.details={expected_set:filenameSet};throw e;}
 const info=inspectForDepartment(buffer,d);let report=null;
 if(req.body.kind==='submission'){const validation=validateTemplate(buffer,d,info);if(!validation.passed){const e=Error('The paper needs template corrections before it can be submitted.');e.status=422;e.details={template:validation};throw e;}report=await screeningFor(d,info,req.body.set_name);report.template=validation;rejectMatches(report);}
 const id=crypto.randomUUID(),file=path.join(data,'files',id+'.docx');fs.writeFileSync(file,buffer);
 try{await run('INSERT INTO papers (id,department_id,campus_id,session,set_name,kind,original_name,path,uploaded_by,counts,valid,reviewed) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)',[id,d.id,d.campus_id,req.body.session,req.body.set_name,req.body.kind,path.basename(name),file,req.user.id,JSON.stringify(info.counts),info.valid?1:0]);
 if(report)await run('INSERT INTO screenings VALUES (?,?)',[id,JSON.stringify(report)]);
 }catch(e){await run('DELETE FROM papers WHERE id=?',[id]);fs.unlinkSync(file);throw e;}
 return {id,set_name:req.body.set_name,counts:info.counts,valid:info.valid,screening:report};
}
app.post('/api/papers',upload.single('file'),async(req,res)=>{if(!req.file)throw Error('Choose a Word document.');res.json(await store(req,req.file.buffer,req.file.originalname));});
app.get('/api/papers/:id/:action',async(req,res)=>{
 const p=(await all(db,'SELECT * FROM papers WHERE id=?',[req.params.id]))[0];const d=p&&departments.find(d=>d.id===p.department_id);
 if(!p||!scope(req.user,d)||(!admin(req.user)&&p.kind==='submission'&&p.uploaded_by!==req.user.id&&req.user.role!=='coordinator'))return res.status(404).json({error:'Paper not found.'});
 if(req.params.action==='download')return res.download(p.path,p.original_name);
 if(req.params.action!=='preview')return res.status(404).end();
 const info=inspectForDepartment(fs.readFileSync(p.path),d);res.json({paper:{...p,path:undefined},screening:JSON.parse((await all(db,'SELECT report FROM screenings WHERE paper_id=?',[p.id]))[0]?.report||'null'),counts:info.counts,valid:info.valid,questions:info.questions.map(({section,text})=>({section,text})),text:require('./papers').text(new (require('@xmldom/xmldom').DOMParser)().parseFromString(new(require('pizzip'))(fs.readFileSync(p.path)).file('word/document.xml').asText(),'application/xml'))});
});
app.post('/api/papers/:id/review',requireAdmin,async(req,res)=>{const p=(await all(db,'SELECT * FROM papers WHERE id=?',[req.params.id]))[0];if(!p||p.kind!=='submission'||!p.valid)throw Error('Only valid complete submissions can be approved.');const d=departments.find(d=>d.id===p.department_id),buffer=fs.readFileSync(p.path),info=inspectForDepartment(buffer,d),validation=validateTemplate(buffer,d,info);if(!validation.passed){const e=Error('The paper needs template corrections before approval.');e.status=422;e.details={template:validation};throw e;}const report=await screeningFor(d,info,p.set_name);report.template=validation;rejectMatches(report);await run('INSERT OR REPLACE INTO screenings VALUES (?,?)',[p.id,JSON.stringify(report)]);await run('UPDATE papers SET reviewed=1 WHERE id=?',[p.id]);res.json({ok:true});});
app.post('/api/templates/:set',requireAdmin,upload.single('file'),async(req,res)=>{if(!['A','B'].includes(req.params.set)||!req.file||!req.file.originalname.toLowerCase().endsWith('.docx'))throw Error('Select a Set A/B Word template.');inspect(req.file.buffer);const file=path.join(data,'files',crypto.randomUUID()+'.docx');fs.writeFileSync(file,req.file.buffer);await run('INSERT OR REPLACE INTO templates VALUES (?,?,?,?)',[req.params.set,req.file.originalname,file,new Date().toISOString()]);res.json({ok:true});});
app.get('/api/templates/:set',async(req,res)=>{const t=(await all(db,'SELECT * FROM templates WHERE set_name=?',[req.params.set]))[0];if(!t)return res.status(404).json({error:'Template not uploaded.'});res.download(t.path,t.original_name);});
let inventory=[];
function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())scan(file);else if(/\.docx$/i.test(e.name)&&!e.name.startsWith('~$')){const rel=path.relative(path.join(parent,'Question Papers 2026'),file);inventory.push({id:inventory.length,name:e.name,relative:rel,path:file});}}}
app.get('/api/inventory',requireAdmin,(req,res)=>res.json(inventory.map(({path:ignored,...f})=>f)));
app.post('/api/import',requireAdmin,async(req,res)=>{const f=inventory.find(f=>f.id===Number(req.body.inventory_id));if(!f)throw Error('Select a local archive document.');req.body.kind='archive';res.json(await store(req,fs.readFileSync(f.path),f.name));});
app.post('/api/generate',requireAdmin,async(req,res)=>{
 const department=departments.find(d=>d.id===Number(req.body.department_id));if(!department)throw Error('Select a department.');const set=req.body.set_name;if(!['A','B'].includes(set))throw Error('Select a set.');
 const matches=departments.filter(d=>departmentKey(d)===departmentKey(department));
 const campusCount=new Set(matches.map(d=>d.campus_id)).size;
 const papers=await all(db,"SELECT * FROM papers WHERE kind='submission' AND session='January 2027' ORDER BY created_at DESC,rowid DESC");
 const latest=new Map();for(const p of papers)if(!latest.has(p.department_id+'|'+p.set_name))latest.set(p.department_id+'|'+p.set_name,p);
 const checked=new Map();
 async function approvedPool(d,sourceSet){
  const key=d.id+'|'+sourceSet;if(checked.has(key))return checked.get(key);
  const p=latest.get(key);
  if(!p?.reviewed)throw Error('Generation needs approved Set '+sourceSet+' for '+d.campus+' / '+d.institution+' / '+d.name+(d.is_common?' from '+d.coordinator_name:'')+'. Subject submissions can be uploaded while Common RM is pending.');
  const buffer=fs.readFileSync(p.path),info=inspectForDepartment(buffer,d),validation=validateTemplate(buffer,d,info);
  if(!validation.passed){const e=Error('Template corrections are required for '+d.name+', Set '+sourceSet+'.');e.status=422;e.details={template:validation};throw e;}
  const report=await screeningFor(d,info,sourceSet);report.template=validation;rejectMatches(report);
  const pool={...p,campus:p.campus_id,paper_type:info.paper_type,questions:info.questions};checked.set(key,pool);return pool;
 }
 const pools=[];
 for(const d of matches)for(const sourceSet of ['A','B']){
  const subject=await approvedPool(d,sourceSet);let questions=subject.questions;
  if(subject.paper_type==='subject_only'){
   const coordinator=departments.find(c=>c.id===d.common_rm_id);
   if(!coordinator)throw Error('Common RM assignment is missing for '+d.name+'.');
   const common=await approvedPool(coordinator,sourceSet);
   questions=[...common.questions.map(q=>({...q,source:common,contributing_department_id:d.id})),...questions];
  }
  pools.push({...subject,questions});
 }
 const opposite=await all(db,'SELECT manifest FROM generations WHERE department_key=? AND set_name<>?',[departmentKey(department),set]);
 const excluded=new Set(opposite.flatMap(g=>JSON.parse(g.manifest).map(q=>q.hash)));
 pools.forEach(p=>p.questions=p.questions.filter(q=>!excluded.has(q.hash)));
 const chosen=choose(pools,campusCount<2,set,department.is_common);const id=crypto.randomUUID(),file=path.join(data,'files',id+'.docx');
 const buffer=generate(chosen,department.name,set);fs.writeFileSync(file,buffer);
 const distribution=JSON.stringify({Ramapuram:chosen.filter(q=>q.source.campus===1).length,Trichy:chosen.filter(q=>q.source.campus===2).length});
 const manifest=JSON.stringify(chosen.map((q,i)=>({number:i+1,section:q.section,campus:q.source.campus,paper_id:q.source.id,department_id:q.source.department_id,source_set:q.source.set_name,contributing_department_id:q.contributing_department_id||q.source.department_id,hash:q.hash,text:q.text})));
 await run('INSERT INTO generations (id,department_key,department_name,set_name,path,distribution,manifest) VALUES (?,?,?,?,?,?,?)',[id,departmentKey(department),department.name,set,file,distribution,manifest]);res.json({id,distribution:JSON.parse(distribution)});
});
app.get('/api/generations/:id/:action',requireAdmin,async(req,res)=>{const g=(await all(db,'SELECT * FROM generations WHERE id=?',[req.params.id]))[0];if(!g)return res.status(404).end();if(req.params.action==='manifest')return res.json({distribution:JSON.parse(g.distribution),questions:JSON.parse(g.manifest)});if(req.params.action!=='download')return res.status(404).end();res.download(g.path,`January-2027-${g.department_name.replace(/[^a-z0-9]/gi,'-')}-Set-${g.set_name}.docx`);});
app.use(express.static(path.join(root,'public')));
app.use((err,req,res,next)=>{console.error(err.message);res.status(err.status||400).json({...err.details,error:err.code==='LIMIT_FILE_SIZE'?'Maximum upload size is 20 MB.':err.message||'Request failed.'});});
async function start(){
 await run('CREATE TABLE IF NOT EXISTS screenings (paper_id TEXT PRIMARY KEY,report TEXT)');
 await run(`CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY,department_id INTEGER,campus_id INTEGER,session TEXT,set_name TEXT,kind TEXT,original_name TEXT,path TEXT,uploaded_by INTEGER,counts TEXT,valid INTEGER,reviewed INTEGER,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
 await run('CREATE TABLE IF NOT EXISTS templates (set_name TEXT PRIMARY KEY,original_name TEXT,path TEXT,updated_at TEXT)');
 await run(`CREATE TABLE IF NOT EXISTS generations (id TEXT PRIMARY KEY,department_key TEXT,department_name TEXT,set_name TEXT,path TEXT,distribution TEXT,manifest TEXT,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
 departments=await all(source,'SELECT d.id,d.name,i.id institution_id,i.name institution,i.campus_id,c.name campus FROM departments d JOIN institutions i ON i.id=d.institution_id JOIN campuses c ON c.id=i.campus_id WHERE d.id NOT IN (100,101) ORDER BY c.id,i.id,d.name');
 const coordinators=await all(source,"SELECT id,username,name,campus_id FROM users WHERE role='coordinator' AND username IN ('vani','infant')");
 const commonAssignments=[{id:201,campus_id:1,campus:'Ramapuram',faculty_code:'FET',institution:'Faculty of Engineering and Technology',username:'vani'},{id:202,campus_id:2,campus:'Trichy',faculty_code:'FET',institution:'College of Engineering and Technology',username:'infant'},{id:-203,campus_id:2,campus:'Trichy',faculty_code:'FSH',institution:'College of Science and Humanities',username:'infant'},{id:-204,campus_id:2,campus:'Trichy',faculty_code:'FMHS',institution:'Faculty of Medical and Health Sciences',username:'infant'}];
 for(const assignment of commonAssignments){const coordinator=coordinators.find(u=>u.username===assignment.username&&u.campus_id===assignment.campus_id);if(!coordinator)throw Error('Assigned research coordinator account not found: '+assignment.username);const record={...assignment,name:'Common Research Methodology ('+assignment.faculty_code+')',is_common:true,coordinator_id:coordinator.id,coordinator_name:coordinator.name};const index=departments.findIndex(d=>d.id===record.id);if(index>=0)departments[index]=record;else departments.push(record);}
 for(const d of departments){d.common_rm_id=commonFor(d);d.submission_format=d.is_common?'25 RM':d.common_rm_id?'25 subject':'25 RM + 25 subject';}
 for(const set of ['A','B']){if(!(await all(db,'SELECT * FROM templates WHERE set_name=?',[set])).length){const original=path.join(parent,'Question_Paper_Setting',`Rmp_Department name_Jan_2027_QP_Set_${set}.docx`);if(fs.existsSync(original)){const dest=path.join(data,'files',`initial-template-${set}.docx`);fs.copyFileSync(original,dest);await run('INSERT INTO templates VALUES (?,?,?,?)',[set,path.basename(original),dest,new Date().toISOString()]);}}}
 if(fs.existsSync(path.join(parent,'Question Papers 2026')))scan(path.join(parent,'Question Papers 2026'));
 return app.listen(Number(process.env.PORT)||3100,process.env.HOST||'127.0.0.1',()=>console.log('Question paper app: http://127.0.0.1:'+(process.env.PORT||3100)));
}
if(require.main===module)start().catch(e=>{console.error(e);process.exit(1);});
module.exports={app,start};
