function sourceDetails(q,departments,papers){
 const department=departments.find(d=>d.id===q.department_id),paper=papers.find(p=>p.id===q.paper_id);
 return {...q,source_campus:q.source_campus||department?.campus||({1:'Ramapuram',2:'Trichy'}[q.campus])||'Unknown campus',source_department:q.source_department||department?.name||'Department '+q.department_id,source_institution:q.source_institution||department?.institution||'',source_file:q.source_file||paper?.original_name||'Original filename unavailable',source_coordinator:q.source_coordinator||department?.coordinator_name||'',source_download_available:Boolean(paper&&!paper.deleted_at)};
}
function sourceRecord(g,departments,papers){
 return {id:g.id,department_name:g.department_name,set_name:g.set_name,created_at:g.created_at,distribution:JSON.parse(g.distribution),questions:JSON.parse(g.manifest).map(q=>sourceDetails(q,departments,papers)).sort((a,b)=>a.number-b.number)};
}
function sourceCsv(record){
 // Excel must treat uploaded text and filenames as text, including a leading formula character.
 const cell=value=>{let s=String(value??'');if(/^[\s\uFEFF]*[=+@-]/u.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const rows=[['Final set','Final question number','Section','Source campus','Source department','Source institution','Source coordinator','Source Word file','Uploaded set','Original question number','Correct option','Answer obtained from','Uploaded question and options']];
 for(const q of record.questions)rows.push([record.set_name,q.number,q.section==='research'?'Research Methodology':q.section==='subject'?'Subject':q.section,q.source_campus,q.source_department,q.source_institution,q.source_coordinator,q.source_file,q.source_set,q.source_question_number,q.answer,q.answer_source==='answer_key'?'Source answer key':q.answer_source==='bold_option'?'Bold source option':q.answer_source,q.text]);
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
module.exports={sourceDetails,sourceRecord,sourceCsv};
