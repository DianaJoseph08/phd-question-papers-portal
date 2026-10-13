function sourceQuestionPreview(q){
 const line=String(q.text||'').split(/\r?\n/).map(s=>s.trim()).find(s=>s&&!/^\d{1,3}[.)]?$/.test(s))||'Question text unavailable';
 return line.length>190?line.slice(0,190)+'…':line;
}
function sourceRecordRows(questions){
 if(!questions.length)return '<tr><td colspan="5" class="empty">No questions match these filters.</td></tr>';
 return questions.map(q=>`<tr><td><strong>${escape(q.number)}</strong><br><span class="badge">${q.section==='research'?'RM':'Subject'}</span></td><td><span class="source-stem">${escape(sourceQuestionPreview(q))}</span><details><summary>Show question and options</summary><div class="source-question">${escape(q.text||'Question text unavailable')}</div></details></td><td><strong>${escape(q.source_campus)}</strong><br>${escape(q.source_department)}${q.source_institution?`<br><small>${escape(q.source_institution)}</small>`:''}${q.source_coordinator?`<br><small>Coordinator: ${escape(q.source_coordinator)}</small>`:''}</td><td><strong>Uploaded Set ${escape(q.source_set||'—')} · Question ${escape(q.source_question_number??'—')}</strong><br><span class="source-filename">${escape(q.source_file)}</span>${q.source_download_available?`<br><a href="/api/papers/${encodeURIComponent(q.paper_id)}/download">Download source Word file</a>`:''}</td><td><strong class="badge good">${escape(q.answer||'—')}</strong><br><small>${q.answer_source==='answer_key'?'Source answer key':q.answer_source==='bold_option'?'Bold source option':'Recorded answer'}</small></td></tr>`).join('');
}
function sourceRecordHtml(record){
 const campuses=[...new Set(record.questions.map(q=>q.source_campus))];
 const date=record.created_at?new Date(record.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'';
 return `<section class="source-record"><h2>Source record · Final Set ${escape(record.set_name)}</h2><p><strong>${escape(record.department_name)}</strong>${date?`<br>Generated ${escape(date)} IST`:''}</p><p>${record.questions.length} generated questions · ${Object.entries(record.distribution||{}).map(([campus,count])=>escape(campus)+': '+escape(count)).join(' · ')}</p><p>Final question numbers match the generated Word paper. Research Methodology rows identify the source department or assigned coordinator.</p><p><a class="button" href="/api/generations/${encodeURIComponent(record.id)}/source-csv">Download source record (Excel CSV)</a> <a class="button" href="/api/generations/${encodeURIComponent(record.id)}/download">Download generated Word paper</a></p><div class="filters"><input id="sourceSearch" aria-label="Search source record" placeholder="Search question, department or filename"><select id="sourceCampus" aria-label="Source campus"><option value="">All campuses</option>${campuses.map(c=>`<option>${escape(c)}</option>`).join('')}</select><select id="sourceSection" aria-label="Question section"><option value="">All sections</option><option value="research">Research Methodology</option><option value="subject">Subject</option></select></div><p id="sourceCount">Showing all ${record.questions.length} questions</p><div class="table-wrap"><table><thead><tr><th>Final question</th><th>Question</th><th>Source campus / department</th><th>Uploaded paper / question</th><th>Correct option</th></tr></thead><tbody id="sourceRows">${sourceRecordRows(record.questions)}</tbody></table></div></section>`;
}
async function showSourceRecord(id){
 try{
  const record=await api(`/generations/${encodeURIComponent(id)}/manifest`);
  $('#previewContent').innerHTML=sourceRecordHtml(record);
  for(const selector of ['#sourceSearch','#sourceCampus','#sourceSection'])$(selector).oninput=()=>{
   const search=$('#sourceSearch').value.trim().toLowerCase(),campus=$('#sourceCampus').value,section=$('#sourceSection').value;
   const questions=record.questions.filter(q=>(!campus||q.source_campus===campus)&&(!section||q.section===section)&&(!search||[q.number,q.text,q.source_campus,q.source_department,q.source_institution,q.source_file,q.source_coordinator].join(' ').toLowerCase().includes(search)));
   $('#sourceRows').innerHTML=sourceRecordRows(questions);$('#sourceCount').textContent=`Showing ${questions.length} of ${record.questions.length} questions`;
  };
  if(!$('#preview').open)$('#preview').showModal();
 }catch(e){message(e.message);}
}
