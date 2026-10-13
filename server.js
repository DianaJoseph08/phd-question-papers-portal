const express=require('express'), multer=require('multer'), sqlite=require('sqlite3'), fs=require('fs'), path=require('path'), crypto=require('crypto');
const {inspect,choose,generate}=require('./papers');
const {screen,departmentKey}=require('./screening');
const {commonFor,inspectForDepartment,validateTemplate,placeholder}=require('./submission-policy');
const {setFromFilename}=require('./public/upload-set');
const cloudStorage=require('./cloud_storage');
const {PersistentData,portableName,open}=require('./persistent-data');
const {DepartmentRegistry}=require('./departments');
const {Accounts,validateNewPassword}=require('./accounts');
const {Audit}=require('./audit');
const root=__dirname, seed=process.env.QUESTION_PAPER_SEED_DIR||path.join(root,'data'), data=process.env.QUESTION_PAPER_DATA_DIR||(cloudStorage.enabled?path.join(require('os').tmpdir(),'qp-runtime'):path.join(root,'data')), parent=path.dirname(root);
const persistence=new PersistentData({data,seed,cloud:cloudStorage});
fs.mkdirSync(path.join(data,'files'),{recursive:true});
function resolvePath(filePath){
 if(!filePath)return filePath;
 if(fs.existsSync(filePath))return filePath;
 const candidate=path.join(data,'files',portableName(filePath));
 if(fs.existsSync(candidate))return candidate;
 const seedFile=path.join(seed,'files',portableName(filePath));
 if(fs.existsSync(seedFile))return seedFile;
 return filePath;
}
async function ensureFileLocal(filePath){
 const resolved=resolvePath(filePath);
 if(fs.existsSync(resolved))return resolved;
 const filename=portableName(filePath), localDest=path.join(data,'files',filename);
 const buf=await cloudStorage.getBufferFromCloudStorage('files/'+filename);
 if(buf){fs.writeFileSync(localDest,buf);return localDest;}
 throw Error('The stored Word document is missing: '+filename);
}
const admissionsDbPath=process.env.ADMISSIONS_DB||[path.join(data,'phd_admissions.db'),path.join(seed,'phd_admissions.db'),path.join(root,'phd_admissions.db'),path.join(parent,'phd_admissions.db')].find(f=>fs.existsSync(f));
let source;
const all=(d,sql,args=[])=>new Promise((resolve,reject)=>d.all(sql,args,(e,r)=>e?reject(e):resolve(r)));
const run=(sql,args=[])=>new Promise((resolve,reject)=>persistence.db.run(sql,args,function(e){e?reject(e):resolve(this)}));
const app=express(), sessions=new Map(), attempts=new Map();
const route=method=>(url,...handlers)=>{const action=handlers.pop();app[method](url,...handlers,(req,res,next)=>persistence.use(async()=>{
 await ensurePortalSchema();await accounts.load();audit.users=accounts.users;registry.hods=accounts.users.filter(u=>u.role==='hod').map(({password:ignored,...u})=>u);departments=await registry.load();
 if(req.token&&!await accounts.validSession(req.user.id,req.session.version)){sessions.delete(req.token);return res.status(401).json({error:'Your password changed. Please sign in again.'});}
 if(req.token&&!['/api/state','/api/password','/api/logout'].includes(req.path)){
  if(req.user.must_change_password)return res.status(403).json({error:'Change your temporary password before using the portal.'});
  if(!paperAccess(req.user))return res.status(403).json({error:'This account can change its password only.'});
 }
 return action(req,res);
}).catch(next));};
const get=route('get'),post=route('post');
if(process.env.TRUST_PROXY==='1'||process.env.TRUST_PROXY==='true'||process.env.NODE_ENV==='production')app.set('trust proxy',1);
app.disable('x-powered-by');app.use(express.json({limit:'1mb'}));
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');res.set('Cache-Control','no-store');res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'");if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('origin')&&req.get('origin')!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Cross-origin request refused.'});next();});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1}});
const {admin,scope,canSubmit,canManageDepartments}=require('./access');
let departments=[],registry,accounts,audit;
const paperAccess=user=>admin(user)||user.role==='hod'||departments.some(d=>d.is_common&&scope(user,d));
async function ensurePortalSchema(){
 await accounts.ensure();await audit.ensure();
 const columns=await all(persistence.db,'PRAGMA table_info(papers)');
 if(!columns.some(c=>c.name==='deleted_at'))await run('ALTER TABLE papers ADD COLUMN deleted_at TEXT');
 if(!columns.some(c=>c.name==='deleted_by'))await run('ALTER TABLE papers ADD COLUMN deleted_by INTEGER');
}
function revokeSessions(userId,except){for(const [token,s] of sessions)if(s.user.id===userId&&token!==except)sessions.delete(token);}
app.get(['/health','/healthz'],(req,res)=>res.status(200).json({ok:true}));
post('/api/login',async(req,res)=>{
 const key=req.ip, history=(attempts.get(key)||[]).filter(t=>Date.now()-t<900000);attempts.set(key,history);
 if(history.length>=10)return res.status(429).json({error:'Too many login attempts. Try again in 15 minutes.'});
 history.push(Date.now());const authenticated=await accounts.authenticate(req.body.username,req.body.password);
 if(!authenticated)return res.status(401).json({error:'Invalid username or password.'});
 const {user,version}=authenticated;await audit.log(user,'account.signed_in','account',user.id);await persistence.commit();
 attempts.delete(key);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{user,version,expires:Date.now()+8*3600000});
 res.cookie('qp_session',token,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:8*3600000});res.json({user});
});
app.use('/api',(req,res,next)=>{const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('qp_session='))?.slice(11);const s=sessions.get(token);if(!s||s.expires<Date.now()){sessions.delete(token);return res.status(401).json({error:'Please sign in.'});}req.user=s.user;req.session=s;req.token=token;next();});
post('/api/logout',async(req,res)=>{await audit.log(req.user,'account.signed_out','account',req.user.id);await persistence.commit();sessions.delete(req.token);res.clearCookie('qp_session');res.json({ok:true});});
post('/api/password',async(req,res)=>{
 const password=validateNewPassword(req.body),user=accounts.users.find(u=>u.id===req.user.id);
 if(!await accounts.verify(user,req.body.current_password))throw Error('Your current password is incorrect.');
 if(await accounts.verify(user,password))throw Error('Choose a new password different from your current password.');
 const version=await accounts.setPassword(user.id,password,user.id);
 await audit.log(req.user,'account.password_changed','account',user.id,{username:user.username});await persistence.commit();
 revokeSessions(user.id,req.token);req.session.version=version;req.user.must_change_password=false;res.json({ok:true});
});
const submissionCountsCache=new Map();
async function currentSubmissionCounts(p){
 if(p.kind!=='submission')return p;
 const d=departments.find(d=>d.id===p.department_id);
 try{
  const localPath=await ensureFileLocal(p.path),stat=fs.statSync(localPath),key=[p.id,stat.mtimeMs,stat.size,d.name,d.common_rm_id,d.is_common].join('|');
  let parsed=submissionCountsCache.get(key);
  if(!parsed){const info=inspectForDepartment(fs.readFileSync(localPath),d,{includeAnswers:false});parsed={counts:JSON.stringify(info.counts),valid:info.valid?1:0};if(submissionCountsCache.size>500)submissionCountsCache.clear();submissionCountsCache.set(key,parsed);}
  return {...p,...parsed};
 }catch(e){return {...p,count_warning:'Original document could not be read. Previously stored counts are shown.'};}
}
get('/api/state',async(req,res)=>{
 if(req.user.must_change_password)return res.json({user:req.user,can_use_papers:false,can_manage_departments:false,institutions:[],hod_accounts:[],departments:[],papers:[],templates:[],generations:[]});
 const rows=await all(persistence.db,`SELECT p.* FROM papers p WHERE p.deleted_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM papers newer
  WHERE newer.department_id=p.department_id AND newer.campus_id=p.campus_id
   AND newer.session=p.session AND newer.set_name=p.set_name AND newer.kind=p.kind
   AND (newer.created_at>p.created_at OR (newer.created_at=p.created_at AND newer.rowid>p.rowid))
 ) ORDER BY p.created_at DESC,p.rowid DESC`);
 const visible=rows.filter(p=>scope(req.user,departments.find(d=>d.id===p.department_id)||{})&&(admin(req.user)||p.kind==='archive'||p.uploaded_by===req.user.id||req.user.role==='coordinator'));
 const current=[];for(const p of visible)current.push(await currentSubmissionCounts(p));
 res.json({user:req.user,can_use_papers:paperAccess(req.user),can_manage_departments:canManageDepartments(req.user),institutions:canManageDepartments(req.user)?registry.institutions:[],hod_accounts:canManageDepartments(req.user)?registry.hods:[],departments:admin(req.user)?departments:departments.filter(d=>scope(req.user,d)),papers:current.map(({path:ignored,...p})=>p),templates:paperAccess(req.user)?await all(persistence.db,'SELECT set_name,original_name,updated_at FROM templates'):[],generations:admin(req.user)?await all(persistence.db,'SELECT id,department_key,department_name,set_name,distribution,created_at FROM generations ORDER BY created_at DESC,rowid DESC'):[]});
});
function requireAdmin(req,res,next){if(!admin(req.user))return res.status(403).json({error:'Administrator access required.'});next();}
get('/api/audit',requireAdmin,async(req,res)=>res.json(await audit.list(req.query)));
get('/api/users',requireAdmin,async(req,res)=>res.json({users:await accounts.list(departments)}));
post('/api/users/:id/reset-password',requireAdmin,async(req,res)=>{
 const target=accounts.users.find(u=>u.id===Number(req.params.id));if(!target)return res.status(404).json({error:'Account not found.'});
 if(target.role==='super_admin'&&req.user.role!=='super_admin')return res.status(403).json({error:'Only the super administrator can reset this account.'});
 const password=validateNewPassword(req.body);
 if(!await accounts.verify(accounts.users.find(u=>u.id===req.user.id),req.body.current_password))throw Error('Your administrator password is incorrect.');
 await accounts.setPassword(target.id,password,req.user.id,true);await audit.log(req.user,'account.password_reset','account',target.id,{username:target.username});await persistence.commit();
 revokeSessions(target.id);if(target.id===req.user.id)res.clearCookie('qp_session');res.json({ok:true,signed_out:target.id===req.user.id});
});
post('/api/departments',(req,res,next)=>{if(!canManageDepartments(req.user))return res.status(403).json({error:'Only Suresh, Ruby or the super administrator can add departments.'});next();},async(req,res)=>{
 let department;await run('SAVEPOINT department_add');
 try{
  const body={...req.body};
  if(body.new_hod){const user=await accounts.createHod(body.new_hod,body.campus_id,req.user.id);registry.hods=accounts.users.filter(u=>u.role==='hod').map(({password:ignored,...u})=>u);body.hod_user_id=user.id;await audit.log(req.user,'account.added','account',user.id,{username:user.username,name:user.name,email:user.email,campus_id:user.campus_id,role:'hod'});}
  department=await registry.create(body,req.user.id);
  await audit.log(req.user,'department.added','department',department.id,{department:department.name,campus:department.campus,institution:department.institution,hod_user_id:department.hod_user_id});await run('RELEASE department_add');
 }catch(e){await run('ROLLBACK TO department_add');await run('RELEASE department_add');await accounts.load();registry.hods=accounts.users.filter(u=>u.role==='hod').map(({password:ignored,...u})=>u);throw e;}
 await persistence.commit();departments=await registry.load();res.status(201).json({department});
});
get('/api/storage-status',requireAdmin,async(req,res)=>res.json({
 mode:cloudStorage.enabled?'cloud':'local',bucket:cloudStorage.BUCKET_NAME||null,
 records:await all(persistence.db,'SELECT kind,session,COUNT(*) count FROM papers GROUP BY kind,session'),
 templates:(await all(persistence.db,'SELECT COUNT(*) count FROM templates'))[0].count
}));
function metadata(req){if(req.body.kind==='submission'&&admin(req.user))throw Error('Only HoDs and assigned research coordinators can submit January 2027 question papers.');const d=departments.find(d=>d.id===Number(req.body.department_id));if(!d||!scope(req.user,d))throw Error('Select an authorized department.');if(req.body.kind==='submission'&&!canSubmit(req.user,d))throw Error('Only the assigned HoD or research coordinator can submit this paper.');const {kind,session,set_name}=req.body;if(!['A','B'].includes(set_name))throw Error('Choose Set A or Set B.');if(kind==='archive'){if(!admin(req.user)||!['January 2026','July 2026'].includes(session))throw Error('Only administrators can upload 2026 papers.');}else if(kind!=='submission'||session!=='January 2027')throw Error('Select a valid session.');return d;}
async function screeningFor(department,info,set) {
 const related=departments.filter(d=>departmentKey(d)===departmentKey(department));
 const rows=await all(persistence.db,"SELECT * FROM papers WHERE kind='archive' ORDER BY created_at DESC,rowid DESC");
 const latest=new Map();for(const p of rows)if(related.some(d=>d.id===p.department_id)){const key=p.department_id+'|'+p.session+'|'+p.set_name;if(!latest.has(key))latest.set(key,p);}
 const missing=[],archives=[];
 for(const d of related)for(const session of ['January 2026','July 2026'])for(const set_name of ['A','B']){
  const p=latest.get(d.id+'|'+session+'|'+set_name);
  if(!p||p.deleted_at){missing.push({campus:d.campus,session,set:set_name,reason:p?'Removed by administrator':'Not uploaded'});continue;}
  let archiveFile;try{archiveFile=await ensureFileLocal(p.path);}catch(e){if(cloudStorage.enabled){const error=Error('An archived Word file could not be loaded from cloud storage. Please retry before submitting.');error.status=503;throw error;}missing.push({campus:d.campus,session,set:set_name,reason:'Archive could not be read; administrator review is needed'});continue;}
  let parsed;try{parsed=inspectForDepartment(fs.readFileSync(archiveFile),d,{includeAnswers:false});}catch(e){missing.push({campus:d.campus,session,set:set_name,reason:'Archive could not be read; administrator review is needed'});continue;}
  if(!parsed.valid)missing.push({campus:d.campus,session,set:set_name,reason:'Archive extraction is incomplete or uses a different historical format; readable questions were still checked'});
  if(parsed.questions.length)archives.push({...p,campus:d.campus,questions:parsed.questions.filter(q=>!placeholder(q))});
 }
 const report=screen(info.questions.filter(q=>!placeholder(q)),archives,set);
 report.coverage={complete:missing.length===0,checked_papers:archives.length,checked_questions:archives.reduce((sum,p)=>sum+p.questions.length,0),issues:missing};
 if(missing.length)report.warning='Repeat checking used the readable archived questions only. Missing or incomplete archives need administrator review.';
 return report;
}
function rejectMatches(report){if(report.rejected){const e=Error('Upload rejected: '+report.matched_count+' questions match the past two sessions. The maximum allowed is 10. Revise the matched questions and upload again.');e.status=422;e.details={screening:report};throw e;}}
async function assessSubmission(d,buffer,info,set,{forGeneration=false}={}){
 // Always return the match report for readable questions, even if counts need correction.
 const report=await screeningFor(d,info,set);
 report.template=validateTemplate(buffer,d,info);
 rejectMatches(report);
 if(forGeneration&&!report.template.passed){const e=Error('This saved paper needs question count or section corrections before final generation.');e.status=422;e.details={screening:report,template:report.template};throw e;}
 report.template.advisory=true;
 return report;
}
async function store(req,buffer,name){
 const d=metadata(req);if(!name.toLowerCase().endsWith('.docx'))throw Error('Only .docx Word documents are accepted.');
 const filenameSet=setFromFilename(name);
 if(req.body.kind==='submission'&&filenameSet&&filenameSet!==req.body.set_name){const e=Error('This filename identifies Set '+filenameSet+', but Set '+req.body.set_name+' is selected. Select Set '+filenameSet+' and upload again. Your existing papers have not been changed.');e.status=422;e.details={expected_set:filenameSet};throw e;}
 const info=inspectForDepartment(buffer,d);let report=null;
 if(req.body.kind==='submission'){
  report=await assessSubmission(d,buffer,info,req.body.set_name);
  const note=String(req.body.note||'').trim();if(note.length>1000)throw Error('Keep your submission remark within 1000 characters.');
  report.submission_note=note;
 }
 const id=crypto.randomUUID(),file=path.join(data,'files',id+'.docx');fs.writeFileSync(file,buffer);
 const previous=(await all(persistence.db,'SELECT id,deleted_at FROM papers WHERE department_id=? AND session=? AND set_name=? AND kind=? ORDER BY created_at DESC,rowid DESC LIMIT 1',[d.id,req.body.session,req.body.set_name,req.body.kind]))[0];
 await cloudStorage.putDocument(file,'files/'+id+'.docx');
 try{await run('INSERT INTO papers (id,department_id,campus_id,session,set_name,kind,original_name,path,uploaded_by,counts,valid,reviewed) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)',[id,d.id,d.campus_id,req.body.session,req.body.set_name,req.body.kind,path.basename(name),file,req.user.id,JSON.stringify(info.counts),info.valid?1:0]);
 if(report)await run('INSERT INTO screenings VALUES (?,?)',[id,JSON.stringify(report)]);
 await audit.log(req.user,previous&&!previous.deleted_at?'paper.replaced':'paper.uploaded','paper',id,{filename:path.basename(name),department:d.name,campus:d.campus,institution:d.institution,session:req.body.session,set:req.body.set_name,kind:req.body.kind,previous_id:previous?.id||null});
 await persistence.commit();
 }catch(e){await run('DELETE FROM papers WHERE id=?',[id]);fs.unlinkSync(file);throw e;}
 return {id,set_name:req.body.set_name,counts:info.counts,valid:info.valid,screening:report};
}
post('/api/papers',upload.single('file'),async(req,res)=>{if(!req.file)throw Error('Choose a Word document.');try{res.json(await store(req,req.file.buffer,req.file.originalname));}catch(e){if(e.status===422){await audit.log(req.user,'paper.rejected','upload_attempt',crypto.randomUUID(),{filename:req.file.originalname,department_id:req.body.department_id,session:req.body.session,set:req.body.set_name,reason:e.message,matched_questions:e.details?.screening?.matched_count});await persistence.commit();}throw e;}});
post('/api/papers/:id/remove',requireAdmin,async(req,res)=>{
 const p=(await all(persistence.db,'SELECT * FROM papers WHERE id=?',[req.params.id]))[0];if(!p||p.deleted_at)return res.status(404).json({error:'Paper not found.'});
 const reason=typeof req.body.reason==='string'?req.body.reason.trim():'';if(reason.length<3||reason.length>500)throw Error('Give a removal reason between 3 and 500 characters.');
 const d=departments.find(d=>d.id===p.department_id);
 await run('UPDATE papers SET deleted_at=?,deleted_by=? WHERE id=?',[new Date().toISOString(),req.user.id,p.id]);
 await audit.log(req.user,'paper.removed','paper',p.id,{filename:p.original_name,department:d?.name,campus:d?.campus,session:p.session,set:p.set_name,kind:p.kind,reason});await persistence.commit();res.json({ok:true});
});
get('/api/papers/:id/:action',async(req,res)=>{
 const p=(await all(persistence.db,'SELECT * FROM papers WHERE id=?',[req.params.id]))[0];const d=p&&departments.find(d=>d.id===p.department_id);
 if(!p||p.deleted_at||!scope(req.user,d)||(!admin(req.user)&&p.kind==='submission'&&p.uploaded_by!==req.user.id&&req.user.role!=='coordinator'))return res.status(404).json({error:'Paper not found.'});
 const localPath=await ensureFileLocal(p.path);
 if(req.params.action==='download')return res.download(localPath,p.original_name);
 if(req.params.action!=='preview')return res.status(404).end();
 const pbuf=fs.readFileSync(localPath),info=inspectForDepartment(pbuf,d);res.json({paper:{...p,path:undefined},template:p.kind==='submission'?validateTemplate(pbuf,d,info):null,screening:JSON.parse((await all(persistence.db,'SELECT report FROM screenings WHERE paper_id=?',[p.id]))[0]?.report||'null'),counts:info.counts,valid:info.valid,questions:info.questions.map(({section,text})=>({section,text})),text:require('./papers').text(new (require('@xmldom/xmldom').DOMParser)().parseFromString(new(require('pizzip'))(pbuf).file('word/document.xml').asText(),'application/xml'))});
});
post('/api/papers/:id/review',requireAdmin,async(req,res)=>{const p=(await all(persistence.db,'SELECT * FROM papers WHERE id=?',[req.params.id]))[0];if(!p||p.deleted_at||p.kind!=='submission')throw Error('Only active submissions can be approved.');const d=departments.find(d=>d.id===p.department_id),localPath=await ensureFileLocal(p.path),buffer=fs.readFileSync(localPath),info=inspectForDepartment(buffer,d),report=await assessSubmission(d,buffer,info,p.set_name);const savedReport=(await all(persistence.db,'SELECT report FROM screenings WHERE paper_id=?',[p.id]))[0];report.submission_note=JSON.parse(savedReport?.report||'{}').submission_note||'';await run('INSERT OR REPLACE INTO screenings VALUES (?,?)',[p.id,JSON.stringify(report)]);await run('UPDATE papers SET reviewed=1,counts=?,valid=? WHERE id=?',[JSON.stringify(info.counts),info.valid?1:0,p.id]);await audit.log(req.user,'paper.approved','paper',p.id,{filename:p.original_name,department:d.name,campus:d.campus,set:p.set_name,matched_questions:report.matched_count});await persistence.commit();res.json({ok:true});});
post('/api/templates/:set',requireAdmin,upload.single('file'),async(req,res)=>{if(!['A','B'].includes(req.params.set)||!req.file||!req.file.originalname.toLowerCase().endsWith('.docx'))throw Error('Select a Set A/B Word template.');inspect(req.file.buffer);const file=path.join(data,'files',crypto.randomUUID()+'.docx');fs.writeFileSync(file,req.file.buffer);await cloudStorage.putDocument(file,'files/'+path.basename(file));await run('INSERT OR REPLACE INTO templates VALUES (?,?,?,?)',[req.params.set,req.file.originalname,file,new Date().toISOString()]);await audit.log(req.user,'template.uploaded','template',req.params.set,{filename:req.file.originalname,set:req.params.set});await persistence.commit();res.json({ok:true});});
get('/api/templates/:set',async(req,res)=>{const t=(await all(persistence.db,'SELECT * FROM templates WHERE set_name=?',[req.params.set]))[0];if(!t)return res.status(404).json({error:'Template not uploaded.'});const localPath=await ensureFileLocal(t.path);res.download(localPath,t.original_name);});
let inventory=[];
function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())scan(file);else if(/\.docx$/i.test(e.name)&&!e.name.startsWith('~$')){const rel=path.relative(path.join(parent,'Question Papers 2026'),file);inventory.push({id:inventory.length,name:e.name,relative:rel,path:file});}}}
get('/api/inventory',requireAdmin,(req,res)=>res.json(inventory.map(({path:ignored,...f})=>f)));
post('/api/import',requireAdmin,async(req,res)=>{const f=inventory.find(f=>f.id===Number(req.body.inventory_id));if(!f)throw Error('Select a local archive document.');req.body.kind='archive';res.json(await store(req,fs.readFileSync(f.path),f.name));});
post('/api/generate',requireAdmin,async(req,res)=>{
 const department=departments.find(d=>d.id===Number(req.body.department_id));if(!department)throw Error('Select a department.');const set=req.body.set_name;if(!['A','B'].includes(set))throw Error('Select a set.');
 const template=(await all(persistence.db,'SELECT * FROM templates WHERE set_name=?',[set]))[0];if(!template)throw Error('Upload the administrator Set '+set+' Word template before generation.');const templateBuffer=fs.readFileSync(await ensureFileLocal(template.path));require('./template-paper').templateParts(templateBuffer);
 const matches=departments.filter(d=>departmentKey(d)===departmentKey(department));
 const campusCount=new Set(matches.map(d=>d.campus_id)).size;
 const papers=await all(persistence.db,"SELECT * FROM papers WHERE kind='submission' AND session='January 2027' ORDER BY created_at DESC,rowid DESC");
 const latest=new Map();for(const p of papers)if(!latest.has(p.department_id+'|'+p.set_name))latest.set(p.department_id+'|'+p.set_name,p);
 const checked=new Map();
 async function approvedPool(d,sourceSet){
  const key=d.id+'|'+sourceSet;if(checked.has(key))return checked.get(key);
  const p=latest.get(key);
  if(!p?.reviewed||p.deleted_at)throw Error('Generation needs approved Set '+sourceSet+' for '+d.campus+' / '+d.institution+' / '+d.name+(d.is_common?' from '+d.coordinator_name:'')+'. Subject submissions can be uploaded while Common RM is pending.');
  const localPath=await ensureFileLocal(p.path),buffer=fs.readFileSync(localPath),info=inspectForDepartment(buffer,d);
  await assessSubmission(d,buffer,info,sourceSet);
  // Assigned Common RM is authoritative. The HoD supplies subject questions only,
  // even if their document also contains a Research Methodology section.
  const questions=d.is_common?info.questions.filter(q=>q.section==='research'):d.common_rm_id?info.questions.filter(q=>q.section==='subject'):info.questions;
  const counts={research:questions.filter(q=>q.section==='research').length,subject:questions.filter(q=>q.section==='subject').length};
  const expected=d.is_common?'25 RM':d.common_rm_id?'25 subject':'25 RM + 25 subject';
  const usable=d.is_common?counts.research===25:d.common_rm_id?counts.subject===25:info.valid;
  const issues=[];
  if(!usable)issues.push({filename:p.original_name,campus:d.campus,department:d.name,set:sourceSet,question:'—',remark:`Need ${expected}. Read ${counts.research} RM / ${counts.subject} subject. Check the source numbering and section headings.`});
  issues.push(...questions.filter(q=>q.answer_error||!q.answer||placeholder(q)).map(q=>({filename:p.original_name,campus:d.campus,department:d.name,set:sourceSet,...require('./answers').answerRemark(q,questions.indexOf(q)),...(placeholder(q)?{remark:'Replace this unused question placeholder.'}:{})})));
  if(issues.length){const e=Error('Correct these source questions or answers before generating the final paper.');e.status=422;e.details={generation_issues:issues};throw e;}
  await run('UPDATE papers SET counts=?,valid=? WHERE id=?',[JSON.stringify(info.counts),info.valid?1:0,p.id]);
  const pool={...p,path:localPath,campus:p.campus_id,paper_type:d.common_rm_id?'subject_only':info.paper_type,questions};checked.set(key,pool);return pool;
 }
 const pools=[],sharedCommon=require('./public/common-rm').commonRmSources(departments,matches);
 if(sharedCommon.missing.length)throw Error('Common RM assignment is missing for '+sharedCommon.missing.join(', ')+'.');
 for(const d of matches)for(const sourceSet of ['A','B']){
  const source=await approvedPool(d,sourceSet);
  if(!d.is_common)pools.push({...source,section:'subject',questions:source.questions.filter(q=>q.section==='subject')});
  if(d.is_common||!d.common_rm_id)pools.push({...source,section:'research',questions:source.questions.filter(q=>q.section==='research')});
 }
 // Common RM is shared by its faculty across campuses, independently of where
 // this subject department is offered. Each coordinator set is included once.
 for(const coordinator of sharedCommon.sources)for(const sourceSet of ['A','B']){
  const source=await approvedPool(coordinator,sourceSet);
  pools.push({...source,section:'research',questions:source.questions.map(q=>({...q,contributing_department_id:department.id}))});
 }
 const sectionCampuses=Object.fromEntries(['research','subject'].map(section=>[section,[...new Set(pools.filter(p=>p.section===section).map(p=>p.campus))]]));
 const opposite=await all(persistence.db,'SELECT manifest FROM generations WHERE department_key=? AND set_name<>?',[departmentKey(department),set]);
 const excluded=new Set(opposite.flatMap(g=>JSON.parse(g.manifest).map(q=>q.hash)));
 pools.forEach(p=>p.questions=p.questions.filter(q=>!excluded.has(q.hash)));
 const chosen=choose(pools,campusCount<2,set,department.is_common,sectionCampuses);const id=crypto.randomUUID(),file=path.join(data,'files',id+'.docx');
 const buffer=generate(chosen,department.name,set,templateBuffer,{facultyName:department.institution});fs.writeFileSync(file,buffer);
 await cloudStorage.putDocument(file,'files/'+id+'.docx');
 const distribution=JSON.stringify({Ramapuram:chosen.filter(q=>q.source.campus===1).length,Trichy:chosen.filter(q=>q.source.campus===2).length});
 const manifest=JSON.stringify(chosen.map((q,i)=>require('./source-record').sourceDetails({number:i+1,section:q.section,campus:q.source.campus,paper_id:q.source.id,department_id:q.source.department_id,source_set:q.source.set_name,source_question_number:q.source_number||q.number||q.answer_key_number,answer:q.answer,answer_source:q.answer_source,contributing_department_id:q.contributing_department_id||q.source.department_id,hash:q.hash,text:q.text},departments,[{id:q.source.id,original_name:q.source.original_name}])));
 await run('INSERT INTO generations (id,department_key,department_name,set_name,path,distribution,manifest) VALUES (?,?,?,?,?,?,?)',[id,departmentKey(department),department.name,set,file,distribution,manifest]);
 await audit.log(req.user,'paper.generated','generation',id,{department:department.name,set,distribution:JSON.parse(distribution),template:template.original_name});
 await persistence.commit();
 res.json({id,department_key:departmentKey(department),department_name:department.name,set_name:set,template_name:template.original_name,distribution:JSON.parse(distribution),question_count:chosen.length,section_distribution:require('./source-record').sectionDistribution(chosen),common_rm:sharedCommon.sources.map(c=>({campus:c.campus,category:c.name,coordinator:c.coordinator_name}))});
});
get('/api/generations/:id/:action',requireAdmin,async(req,res)=>{
 const g=(await all(persistence.db,'SELECT * FROM generations WHERE id=?',[req.params.id]))[0];if(!g)return res.status(404).end();
 if(req.params.action==='manifest'&&req.query.format!=='json'&&/text\/html/i.test(req.get('accept')||'')){res.vary('Accept');return res.sendFile(path.join(root,'public','source-record.html'));}
 if(['manifest','source-csv'].includes(req.params.action)){
  const papers=await all(persistence.db,'SELECT id,original_name,deleted_at FROM papers'),record=require('./source-record').sourceRecord(g,departments,papers);
  if(req.params.action==='manifest'){res.vary('Accept');return res.json(record);}
  res.attachment('January-2027-'+g.department_name.replace(/[^a-z0-9]/gi,'-')+'-Set-'+g.set_name+'-Source-Record.csv');res.type('text/csv');return res.send(require('./source-record').sourceCsv(record));
 }
 if(req.params.action!=='download')return res.status(404).end();const localPath=await ensureFileLocal(g.path);res.download(localPath,`January-2027-${g.department_name.replace(/[^a-z0-9]/gi,'-')}-Set-${g.set_name}.docx`);
});
app.use(express.static(path.join(root,'public')));
app.use((err,req,res,next)=>{console.error(err.message);res.status(err.status||400).json({...err.details,error:err.code==='LIMIT_FILE_SIZE'?'Maximum upload size is 20 MB.':err.message||'Request failed.'});});
async function start(){
 await persistence.initialize();
 if(!admissionsDbPath)throw Error('Admissions account database is missing.');
 source=await open(admissionsDbPath,sqlite.OPEN_READONLY);
  await run('CREATE TABLE IF NOT EXISTS screenings (paper_id TEXT PRIMARY KEY,report TEXT)');
  await run(`CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY,department_id INTEGER,campus_id INTEGER,session TEXT,set_name TEXT,kind TEXT,original_name TEXT,path TEXT,uploaded_by INTEGER,counts TEXT,valid INTEGER,reviewed INTEGER,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  await run('CREATE TABLE IF NOT EXISTS templates (set_name TEXT PRIMARY KEY,original_name TEXT,path TEXT,updated_at TEXT)');
  await run(`CREATE TABLE IF NOT EXISTS generations (id TEXT PRIMARY KEY,department_key TEXT,department_name TEXT,set_name TEXT,path TEXT,distribution TEXT,manifest TEXT,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  departments=await all(source,'SELECT d.id,d.name,i.id institution_id,i.name institution,i.campus_id,c.name campus FROM departments d JOIN institutions i ON i.id=d.institution_id JOIN campuses c ON c.id=i.campus_id WHERE d.id NOT IN (100,101) ORDER BY c.id,i.id,d.name');
  const coordinators=await all(source,"SELECT id,username,name,campus_id FROM users WHERE role='coordinator' AND username IN ('vani','infant')");
  const commonAssignments=[{id:201,campus_id:1,campus:'Ramapuram',faculty_code:'FET',institution:'Faculty of Engineering and Technology',username:'vani'},{id:202,campus_id:2,campus:'Trichy',faculty_code:'FET',institution:'College of Engineering and Technology',username:'infant'},{id:-203,campus_id:2,campus:'Trichy',faculty_code:'FSH',institution:'College of Science and Humanities',username:'infant'},{id:-204,campus_id:2,campus:'Trichy',faculty_code:'FMHS',institution:'Faculty of Medical and Health Sciences',username:'infant'}];
  for(const assignment of commonAssignments){const coordinator=coordinators.find(u=>u.username===assignment.username&&u.campus_id===assignment.campus_id);if(!coordinator)throw Error('Assigned research coordinator account not found: '+assignment.username);const record={...assignment,name:'Common Research Methodology ('+assignment.faculty_code+')',is_common:true,coordinator_id:coordinator.id,coordinator_name:coordinator.name};const index=departments.findIndex(d=>d.id===record.id);if(index>=0)departments[index]=record;else departments.push(record);}
  const institutions=await all(source,"SELECT i.id,i.name,i.campus_id,c.name campus FROM institutions i JOIN campuses c ON c.id=i.campus_id WHERE i.campus_id IN (1,2) AND LOWER(i.name) NOT LIKE '%research office%' ORDER BY c.id,i.name");
  const hods=await all(source,"SELECT id,username,name,campus_id,department_id FROM users WHERE role='hod' ORDER BY campus_id,name");
  registry=new DepartmentRegistry({db:()=>persistence.db,base:departments,institutions,hods});departments=await registry.load();
  const userColumns=await all(source,'PRAGMA table_info(users)');
  const users=await all(source,`SELECT id,username,password,name,role,campus_id,department_id,${userColumns.some(c=>c.name==='email')?'email':'NULL AS email'} FROM users ORDER BY name`);
  accounts=new Accounts({db:()=>persistence.db,users});audit=new Audit({db:()=>persistence.db,users});await ensurePortalSchema();
  for(const set of ['A','B']){if(!(await all(persistence.db,'SELECT * FROM templates WHERE set_name=?',[set])).length){const original=path.join(parent,'Question_Paper_Setting',`Rmp_Department name_Jan_2027_QP_Set_${set}.docx`);if(fs.existsSync(original)){const dest=path.join(data,'files',`initial-template-${set}.docx`);fs.copyFileSync(original,dest);await run('INSERT INTO templates VALUES (?,?,?,?)',[set,path.basename(original),dest,new Date().toISOString()]);}}}
  if(fs.existsSync(path.join(parent,'Question Papers 2026')))scan(path.join(parent,'Question Papers 2026'));
 const recovery=await persistence.recoverSeed();
 await accounts.load();audit.users=accounts.users;
 await audit.bootstrap();
 console.log('[Storage] Ready:',JSON.stringify(recovery));
 const port=Number(process.env.PORT)||8080, host=process.env.HOST||'0.0.0.0';
 const server=app.listen(port,host,()=>console.log('Question paper app: http://'+host+':'+port));
 return server;
}
if(require.main===module)start().catch(e=>{console.error(e);process.exit(1);});
module.exports={app,start};
