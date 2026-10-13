// Shared by the generation API and matrix so approval requirements agree.
function commonRmSources(departments,subjects){
 const sources=new Map(),missing=[];
 for(const d of subjects){
  if(!d.common_rm_id)continue;
  const assigned=departments.find(c=>c.id===d.common_rm_id&&c.is_common);
  if(!assigned){missing.push(d.name||String(d.id));continue;}
  const shared=assigned.faculty_code?departments.filter(c=>c.is_common&&c.faculty_code===assigned.faculty_code):[assigned];
  for(const c of shared)sources.set(c.id,c);
 }
 return {sources:[...sources.values()],missing};
}
if(typeof module!=='undefined')module.exports={commonRmSources};
