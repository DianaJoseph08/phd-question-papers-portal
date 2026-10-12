const crypto=require('crypto');
const {all,run}=require('./persistent-data');
function redact(value){
 if(Array.isArray(value))return value.map(redact);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/password|secret|token|credential|hash|salt/i.test(key)).map(([key,v])=>[key,redact(v)]));
 return value;
}
class Audit{
 constructor({db,users}){Object.assign(this,{db,users});}
 async ensure(){await run(this.db(),`CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,actor_id INTEGER,actor_username TEXT,actor_name TEXT,action TEXT NOT NULL,
  target_type TEXT NOT NULL,target_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL
 )`);}
 async log(actor,action,type,id,details={},createdAt=new Date().toISOString(),eventId=crypto.randomUUID()){
  // SQLite CURRENT_TIMESTAMP is UTC, although its text has no timezone suffix.
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(createdAt))createdAt=new Date(createdAt.replace(' ','T')+'Z').toISOString();
  await run(this.db(),'INSERT OR IGNORE INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)',[eventId,actor?.id||null,actor?.username||'Unknown',actor?.name||'Unknown',action,type,String(id),JSON.stringify(redact(details)),createdAt]);
 }
 async bootstrap(){
  const papers=await all(this.db(),"SELECT * FROM papers p WHERE NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.target_type='paper' AND a.target_id=p.id AND a.action IN ('paper.uploaded','paper.replaced','paper.imported'))");
  for(const p of papers)await this.log(this.users.find(u=>u.id===p.uploaded_by),'paper.imported','paper',p.id,{filename:p.original_name,department_id:p.department_id,campus_id:p.campus_id,session:p.session,set:p.set_name,kind:p.kind,historical:true},p.created_at,'history-paper:'+p.id);
  const departments=await all(this.db(),"SELECT * FROM custom_departments d WHERE NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.target_type='department' AND a.target_id=CAST(d.id AS TEXT) AND a.action='department.added')");
  for(const d of departments)await this.log(this.users.find(u=>u.id===d.created_by),'department.added','department',d.id,{department:d.name,institution_id:d.institution_id,hod_user_id:d.hod_user_id,historical:true},d.created_at,'history-department:'+d.id);
 }
 async list({offset=0,limit=50,action='',search=''}={}){
  offset=Math.max(0,Math.min(1000000,Number(offset)||0));limit=Math.max(1,Math.min(100,Number(limit)||50));
  const clauses=[],args=[];
  if(action){clauses.push('action=?');args.push(action);}
  if(search){clauses.push("(actor_username LIKE ? ESCAPE '\\' OR actor_name LIKE ? ESCAPE '\\' OR details LIKE ? ESCAPE '\\')");const value='%'+String(search).slice(0,200).replace(/[\\%_]/g,'\\$&')+'%';args.push(value,value,value);}
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const total=(await all(this.db(),'SELECT COUNT(*) total FROM audit_events'+where,args))[0].total;
  const rows=await all(this.db(),'SELECT * FROM audit_events'+where+' ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?',[...args,limit,offset]);
  return {total,offset,limit,events:rows.map(e=>({...e,details:JSON.parse(e.details)}))};
 }
}
module.exports={Audit,redact};
