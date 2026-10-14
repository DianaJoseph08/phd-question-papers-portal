const {admin,canTrackSubmissions}=require('./access');
const {canTrack,coordinatorAssignment}=require('./coordinators');
const SESSION='January 2027';
function trackedDepartments(user,departments){
 return canTrackSubmissions(user)?departments.filter(d=>admin(user)||canTrack(user,d)):[];
}
function latestSubmissionRecords(papers){
 // The caller orders equal timestamps by SQLite rowid descending, as in the library.
 const latest=new Map();
 for(const p of [...papers].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))){
  if(p.kind!=='submission'||p.session!==SESSION)continue;
  const key=[p.department_id,p.campus_id,p.set_name].join('|');
  if(!latest.has(key))latest.set(key,p);
 }
 return [...latest.values()];
}
const currentSubmissions=papers=>latestSubmissionRecords(papers).filter(p=>!p.deleted_at);
function parse(value,fallback){try{return typeof value==='string'?JSON.parse(value):value??fallback;}catch{return fallback;}}
function paperRemarks(report,check){
 const remarks=[];
 if(check?.error)remarks.push({category:'Reading check',message:check.error,attention:true});
 const template=check?.template;
 if(!template&&!check?.error)remarks.push({category:'Reading check',message:'Current template and answer checks are unavailable. Administrator review is needed.',attention:true});
 if(template){
  for(const error of template.errors||[])remarks.push({category:'Question count / sections',message:error,attention:true});
  for(const error of template.option_errors||[])remarks.push({category:'Option labels',question:error.question,section:error.section,message:error.missing?'Option label(s) '+error.missing+' were not detected. Check the original Word file.':error.problem,attention:true});
  for(const error of template.answer_errors||[])remarks.push({category:'Answer check',question:error.question,section:error.section,message:error.remark,attention:true});
  for(const warning of template.warnings||[])remarks.push({category:'Template note',message:warning,attention:false});
 }
 if(!report)remarks.push({category:'Repeat screening',message:'No saved screening report is available. Administrator review is needed.',attention:true});
 else{
  if(report.matched_count>0)remarks.push({category:'Repeated / rephrased questions',message:report.matched_count+' uploaded question(s) matched past papers. '+(report.matched_count>10?'This exceeds the limit of 10.':'Within the limit of 10; review the matched questions.'),attention:report.matched_count>10});
  if(report.warning)remarks.push({category:'Archive coverage',message:report.warning,attention:false});
  if(report.submission_note)remarks.push({category:'Uploader note',message:report.submission_note,attention:false});
 }
 return remarks;
}
function buildTracker({user,departments,users=[],papers=[],screenings=new Map(),checks=new Map(),attempts=[]}){
 const latest=latestSubmissionRecords(papers),allowed=trackedDepartments(user,departments);
 const rows=allowed.map(d=>{
  const sets=['A','B'].map(set=>{
   const record=latest.find(p=>p.department_id===d.id&&p.campus_id===d.campus_id&&p.set_name===set),paper=record&&!record.deleted_at?record:null;
   const rejected=attempts.find(a=>{
    const details=parse(a.details,{});
    return Number(details.department_id)===d.id&&details.session===SESSION&&details.set===set&&(!record||a.created_at>record.created_at);
   });
   const latest_attempt=rejected?{filename:parse(rejected.details,{}).filename,reason:parse(rejected.details,{}).reason,at:rejected.created_at,by:rejected.actor_name}:null;
   if(!paper)return {set,status:'pending',remarks:[],latest_attempt};
   const report=parse(screenings.get(paper.id),null),check=checks.get(paper.id),remarks=paperRemarks(report,check);
   const uploader=users.find(u=>u.id===paper.uploaded_by);
   return {set,id:paper.id,status:paper.reviewed?'approved':'submitted',filename:paper.original_name,
    uploaded_at:paper.created_at,uploaded_by:uploader?.name||'Account '+paper.uploaded_by,
    counts:check?.template?.counts||parse(paper.counts,{}),remarks,needs_attention:remarks.some(r=>r.attention),
    checks_available:Boolean(check?.template)&&Boolean(report),
    matched_count:report?.matched_count??null,latest_attempt};
  });
  const submitted=sets.filter(s=>s.id).length;
  return {department_id:d.id,department:d.name,institution:d.institution,campus:d.campus,is_common:Boolean(d.is_common),
   responsible:d.is_common?d.coordinator_name:d.hod_name,submission_format:d.submission_format,sets,
   completed:submitted===2,pending_sets:sets.filter(s=>!s.id).map(s=>s.set),
   needs_attention:sets.some(s=>s.needs_attention||s.latest_attempt),approved:sets.every(s=>s.status==='approved')};
 }).sort((a,b)=>a.campus.localeCompare(b.campus)||a.institution.localeCompare(b.institution)||a.department.localeCompare(b.department));
 const subjects=rows.filter(d=>!d.is_common),common=rows.filter(d=>d.is_common);
 return {session:SESSION,assignment:coordinatorAssignment(user),updated_at:new Date().toISOString(),
  summary:{departments:subjects.length,completed:subjects.filter(d=>d.completed).length,pending:subjects.filter(d=>!d.completed).length,
   needs_attention:subjects.filter(d=>d.needs_attention).length,pending_sets:subjects.reduce((n,d)=>n+d.pending_sets.length,0),
   common_categories:common.length,common_completed:common.filter(d=>d.completed).length},departments:rows};
}
module.exports={SESSION,trackedDepartments,currentSubmissions,paperRemarks,buildTracker};
