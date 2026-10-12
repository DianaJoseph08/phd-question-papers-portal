const {all,run}=require('./persistent-data');
const {commonFor}=require('./submission-policy');
const normalize=value=>value.trim().replace(/\s+/g,' ').toLowerCase();

class DepartmentRegistry{
 constructor({db,base,institutions,hods}){Object.assign(this,{db,base,hods});this.institutions=institutions.map(i=>({...i,common_rm_id:commonFor({campus_id:i.campus_id,institution:i.name})}));}
 async load(){
  await run(this.db(),`CREATE TABLE IF NOT EXISTS custom_departments (
   id INTEGER PRIMARY KEY,name TEXT NOT NULL,institution_id INTEGER NOT NULL,
   hod_user_id INTEGER,created_by INTEGER NOT NULL,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const custom=await all(this.db(),'SELECT * FROM custom_departments ORDER BY id');
  return [...this.base,...custom.map(d=>{
   const institution=this.institutions.find(i=>i.id===d.institution_id);
   if(!institution)throw Error('The faculty for a saved department is unavailable. Contact the administrator.');
   return {...d,is_custom:true,institution:institution.name,campus_id:institution.campus_id,campus:institution.campus};
  })].map(d=>{
   const hod=this.hods.find(u=>d.is_custom?u.id===d.hod_user_id:u.department_id===d.id&&u.campus_id===d.campus_id);
   const common_rm_id=commonFor(d);
   return {...d,hod_name:hod?.name||null,common_rm_id,submission_format:d.is_common?'25 RM':common_rm_id?'25 subject':'25 RM + 25 subject'};
  });
 }
 async create(body,adminId){
  const current=await this.load();
  const name=typeof body.name==='string'?body.name.trim().replace(/\s+/g,' '):'';
  if(name.length<2||name.length>120)throw Error('Enter a department name between 2 and 120 characters.');
  if(/common\s+research\s+methodology/i.test(name))throw Error('Common Research Methodology categories are already managed by the assigned coordinators. Add a subject department here.');
  const institution=this.institutions.find(i=>i.id===Number(body.institution_id));
  if(!institution)throw Error('Select a valid campus faculty or institution.');
  if(body.campus_id!==undefined&&Number(body.campus_id)!==institution.campus_id)throw Error('Select a faculty belonging to the selected campus.');
  if(current.some(d=>d.institution_id===institution.id&&normalize(d.name)===normalize(name))){const e=Error('This department already exists in the selected campus and faculty. Use its existing upload option.');e.status=409;throw e;}
  let hod_user_id=null;
  if(body.hod_user_id!==undefined&&body.hod_user_id!==null&&body.hod_user_id!==''){
   const hod=this.hods.find(u=>u.id===Number(body.hod_user_id)&&u.campus_id===institution.campus_id);
   if(!hod)throw Error('Choose an existing HoD account from the selected campus.');
   hod_user_id=hod.id;
  }
  const id=Math.max(999,...current.map(d=>d.id))+1;
  await run(this.db(),'INSERT INTO custom_departments (id,name,institution_id,hod_user_id,created_by) VALUES (?,?,?,?,?)',[id,name,institution.id,hod_user_id,adminId]);
  return (await this.load()).find(d=>d.id===id);
 }
}
module.exports={DepartmentRegistry};
