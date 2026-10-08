const fs=require('fs'),path=require('path'),Zip=require('pizzip'),sqlite=require('sqlite3'),crypto=require('crypto');
const input='D:/Phd_Admissions_Webapp/Question Papers 2026 Final.zip';
const dir=path.join(__dirname,'data','final-archive-import');fs.mkdirSync(dir,{recursive:true});
const map={1:[1,30],2:[2,31],3:[3,32],4:[4,null],5:[5,33],6:[6,34],7:[8,35],8:[9,36],9:[10,37],10:[7,null],11:[15,38],12:[12,39],13:[14,40],14:[null,41],15:[null,42],16:[18,108],17:[20,null],18:[19,107],19:[16,null],20:[null,43],21:[null,44],22:[null,45],23:[null,46],24:[null,47],25:[28,null],26:[29,102]};
async function main(){
 const z=new Zip(fs.readFileSync(input));const plan=[],skipped=[],pending=[];
 for(const entry of Object.values(z.files).filter(f=>!f.dir)){
  const relative=entry.name,parts=relative.split('/'),name=parts.at(-1);
  if(!/\.docx?$/i.test(name)||/answer|ans[ _-]*key|report/i.test(name)||name.startsWith('~$')){skipped.push({file:relative,reason:'Answer key, report, spreadsheet or temporary file'});continue;}
  const n=Number(parts[1]?.match(/^(\d+)_/)?.[1]);let campus=parts.includes('Ramapuram')?1:parts.includes('Trichy')?2:null;
  if(!campus&&map[n]){const ids=map[n];if(ids.filter(Boolean).length===1)campus=ids[0]?1:2;}
  const session=parts.some(p=>/^(January|Janaury)[_-]2026$/i.test(p))?'January 2026':parts.some(p=>/^July[_-]2026$/i.test(p))?'July 2026':null;
  const setToken=name.match(/set[ _-]*([ab12])(?=[^a-z0-9]|$)/i)?.[1]?.toUpperCase();const set=setToken==='1'?'A':setToken==='2'?'B':setToken;
  let department=map[n]?.[campus-1];if(n===7&&parts.includes('S&H')&&campus===1)department=13;
  if(parts[1]?.startsWith('Common_Research'))department=parts.includes('FMHS')?-204:parts.includes('FSH')?-203:campus===1?201:campus===2?202:null;
  if(!department||!session||!set){pending.push({file:relative,reason:!department?'Department/campus mapping required':!session?'Session/campus/set mapping required':'Set label not specified',department,session,set});continue;}
  const content=entry.asNodeBuffer(),hash=crypto.createHash('sha256').update(content).digest('hex');const staged=path.join(dir,hash+path.extname(name).toLowerCase());if(!fs.existsSync(staged))fs.writeFileSync(staged,content);
  plan.push({file:relative,original_name:name,department_id:department,campus_id:campus,session,set_name:set,staged,hash});
 }
 const grouped=new Map();for(const p of plan){const key=[p.department_id,p.session,p.set_name].join('|');if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(p);}
 const ready=[];for(const rows of grouped.values()){if(rows.length>1)pending.push(...rows.map(r=>({...r,reason:'Multiple source files for same department/session/set'})));else ready.push(rows[0]);}
 const report={zip:input,ready,skipped,pending};fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(report,null,2));
 if(!process.argv.includes('--upload')){console.log(JSON.stringify({ready:ready.length,convert:ready.filter(p=>p.staged.endsWith('.doc')).map(p=>({file:p.original_name,staged:p.staged})),skipped:skipped.length,pending},null,2));return;}
 const source=new sqlite.Database(path.join(__dirname,'..','phd_admissions.db'),sqlite.OPEN_READONLY);
 const user=await new Promise((resolve,reject)=>source.get("SELECT id,username,password FROM users WHERE username='suresh' AND role='admin'",(e,r)=>e?reject(e):resolve(r)));source.close();if(!user)throw Error('Selected administrator account is unavailable.');
 const response=await fetch('http://127.0.0.1:3100/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password:user.password})});if(!response.ok)throw Error('Admin login failed.');const cookie=response.headers.get('set-cookie').split(';')[0];
 const logFile=path.join(dir,'results.json');const results=fs.existsSync(logFile)?JSON.parse(fs.readFileSync(logFile)):[];
 const state=await (await fetch('http://127.0.0.1:3100/api/state',{headers:{Cookie:cookie}})).json();fs.writeFileSync(path.join(dir,'before-import.json'),JSON.stringify(state.papers,null,2));
 for(const p of ready){if(results.some(r=>r.file===p.file&&r.hash===p.hash&&r.id))continue;
  const file=p.staged.endsWith('.doc')?p.staged+'x':p.staged;if(!fs.existsSync(file)){console.log('Conversion required: '+p.original_name);continue;}
  const form=new FormData();form.set('file',new Blob([fs.readFileSync(file)]),p.original_name.replace(/\.doc$/i,'.docx'));form.set('department_id',p.department_id);form.set('session',p.session);form.set('set_name',p.set_name);form.set('kind','archive');
  const uploaded=await fetch('http://127.0.0.1:3100/api/papers',{method:'POST',headers:{Cookie:cookie},body:form});const result=await uploaded.json();
  results.push({...p,...result,status:uploaded.status});fs.writeFileSync(logFile,JSON.stringify(results,null,2));if(!uploaded.ok)console.log('Failed: '+p.original_name+' — '+result.error);
 }
 const after=await (await fetch('http://127.0.0.1:3100/api/state',{headers:{Cookie:cookie}})).json();let verified=0;
 for(const r of results.filter(r=>r.id)){const paper=after.papers.find(p=>p.id===r.id);if(!paper||paper.uploaded_by!==user.id||paper.kind!=='archive'||paper.department_id!==r.department_id||paper.session!==r.session||paper.set_name!==r.set_name)throw Error('Imported metadata verification failed: '+r.file);verified++;}
 console.log(JSON.stringify({uploaded:results.filter(r=>r.id).length,verified,failed:results.filter(r=>!r.id).length,pending:pending.length,skipped:skipped.length,report:logFile}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
