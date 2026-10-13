function groupKey(d){if(d.name?.trim().toLowerCase()==="mathematics")return "mathematics|all faculties";if(d.is_common)return "common-research-methodology|"+d.faculty_code;return d.name.toLowerCase().replace(/\s*\(.*?\)/g,'').trim()+'|'+(/engineering/i.test(d.institution)?'engineering':/management/i.test(d.institution)?'management':/dental/i.test(d.institution)?'dental':/allied|occupational/i.test(d.institution)?'health':'science');}
function groups(){const result=new Map();for(const d of state.departments){const k=groupKey(d);if(!result.has(k))result.set(k,[]);result.get(k).push(d);}return [...result.values()];}
function latestSubmission(d,set){return state.papers.find(p=>p.department_id===d.id&&p.set_name===set&&p.kind==='submission');}
function campusCell(ds,campus,set){const members=ds.filter(d=>d.campus_id===campus);if(!members.length)return '<td><span class="na">N/A</span></td>';return '<td>'+members.map(d=>{const p=latestSubmission(d,set);return `<div class="campus-source">${members.length>1?`<small>${escape(d.institution)}</small><br>`:''}${p?`<button class="badge ${p.reviewed?'good':'warn'}" data-preview="${p.id}">${p.reviewed?'Approved':'Review pending'}</button><br><a href="/api/papers/${p.id}/download">View Word file</a>${isAdmin()?`<br><button data-review="${p.id}">Review</button>`:''}`:'<span class="badge warn">◷ Pending</span>'}</div>`;}).join('')+'</td>';}
function commonReady(d,set){const common=commonRmSources(state.departments,[d]);return !common.missing.length&&common.sources.every(c=>Boolean(latestSubmission(c,set)?.reviewed));}
function generationScope(ds){const common=commonRmSources(state.departments,ds).sources,subjectCampuses=new Set(ds.map(d=>d.campus_id)).size,rmCampuses=new Set(common.map(c=>c.campus_id)).size;if(ds[0].is_common)return ds.length===1?'25 RM questions · own campus':'25 RM questions · 13/12 campus split';if(subjectCampuses===1)return rmCampuses>1?'25 subject · own campus / 25 Common RM · both campuses':'Own campus · both subject sets';return '25 questions per campus · both source sets';}
function matrix(){return `<section class="matrix-panel"><h2>Question Papers Matrix</h2><p>Create final Set A and final Set B by selecting and shuffling approved uploaded questions. Each final set uses its corresponding admin Word template. Subject questions use the participating department campuses. Common Research Methodology combines both campuses within the same faculty, even when the subject department is offered at one campus. Both approved sets are required from every subject department and Common RM coordinator.</p><div class="table-wrap"><table class="matrix"><thead><tr><th>S.No</th><th>Department</th><th>RMP Set A</th><th>RMP Set B</th><th>TRY Set A</th><th>TRY Set B</th><th>Actions</th></tr></thead><tbody>${groups().map((ds,i)=>{const subjectsReady=ds.every(d=>['A','B'].every(set=>latestSubmission(d,set)?.reviewed));const ready=subjectsReady&&ds.every(d=>['A','B'].every(set=>commonReady(d,set)));return `<tr><td>${i+1}</td><td><strong>${escape(ds[0].name)}</strong><br><small>${escape(groupKey(ds[0]).split('|')[1])}</small>${ds[0].is_common?`<br><small>${ds.map(d=>escape(d.campus+": "+d.coordinator_name)).join("<br>")}</small>`:""}</td>${[1,2].flatMap(campus=>['A','B'].map(set=>campusCell(ds,campus,set))).join('')}<td>${ready?`<button data-generate="${ds[0].id}" data-set="A">Generate final Set A</button><button data-generate="${ds[0].id}" data-set="B">Generate final Set B</button>`:`<button disabled>${subjectsReady?'Awaiting approved Common RM':'Awaiting both approved sets'}</button>`}<br><small>${escape(generationScope(ds))}</small></td></tr>`;}).join('')}</tbody></table></div></section>`;}
function hodTracker(){return `<div class="panel"><h2>Your January 2027 submissions</h2>${papersTable(state.papers.filter(p=>p.kind==='submission'))}</div>`;}
function distributionText(value){try{return Object.entries(typeof value==='string'?JSON.parse(value):value).map(([campus,count])=>campus+': '+count).join(' · ');}catch(e){return 'See source record';}}
let generatedDepartmentKey='';
function generatedKey(g){return g.department_key||g.department_name.trim().toLowerCase();}
function generatedDepartments(papers){
 const map=new Map();for(const g of papers)if(!map.has(generatedKey(g)))map.set(generatedKey(g),{key:generatedKey(g),name:g.department_name});
 const values=[...map.values()];return values.map(d=>({...d,label:values.filter(v=>v.name===d.name).length>1?d.name+' · '+d.key.split('|').slice(1).join(' / '):d.name})).sort((a,b)=>a.label.localeCompare(b.label));
}
function currentGeneratedSets(papers,key){
 const latest=new Map();for(const g of papers.filter(g=>generatedKey(g)===key).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))))if(!latest.has(g.set_name))latest.set(g.set_name,g);
 return ['A','B'].map(set=>latest.get(set)||{set_name:set,missing:true});
}
function generatedFinalRows(papers,key){
 return '<div class="table-wrap"><table><thead><tr><th>Final set</th><th>Campus distribution</th><th>Generated (IST)</th><th>Actions</th></tr></thead><tbody>'+currentGeneratedSets(papers,key).map(g=>g.missing?`<tr><td><strong>Set ${g.set_name}</strong></td><td colspan="3">Not generated yet</td></tr>`:`<tr><td><strong>Set ${escape(g.set_name)}</strong></td><td>${escape(distributionText(g.distribution))}</td><td>${escape(new Date(g.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))}</td><td><a class="button" href="/api/generations/${encodeURIComponent(g.id)}/download">View Word file</a><a class="button" href="/api/generations/${encodeURIComponent(g.id)}/download">Download</a><button data-source-record="${escape(g.id)}">View source record</button></td></tr>`).join('')+'</tbody></table></div>';
}
function generationHistory(){
 const papers=state.generations,departments=generatedDepartments(papers);if(!departments.some(d=>d.key===generatedDepartmentKey))generatedDepartmentKey=departments[0]?.key||'';
 return `<div class="panel generated-papers"><h2>Final question papers</h2><p>Select a department to open its latest generated Set A and Set B. View Word file opens the saved Word document; your browser may download it for opening in Microsoft Word.</p>${papers.length?`<div class="filters"><label>Department<select id="generatedDepartment" aria-label="Generated department">${departments.map(d=>`<option value="${escape(d.key)}"${d.key===generatedDepartmentKey?' selected':''}>${escape(d.label)}</option>`).join('')}</select></label></div><div id="generationRows">${generatedFinalRows(papers,generatedDepartmentKey)}</div>`:'<p>No papers generated yet.</p><button data-nav="generate">Generate examination papers</button>'}</div>`;
}
function bindGeneratedPapers(){
 if(!$('#generatedDepartment'))return;
 $('#generatedDepartment').oninput=()=>{generatedDepartmentKey=$('#generatedDepartment').value;$('#generationRows').innerHTML=generatedFinalRows(state.generations,generatedDepartmentKey);};
}
function showGenerationProgress(set){
 const panel=$('#generationStatus');if(!panel)return;
 panel.hidden=false;panel.setAttribute('role','status');panel.innerHTML=`<h2>Generating final Set ${escape(set)}</h2><p>Checking approved source papers and preparing the Word document. Please wait for the result.</p>`;panel.scrollIntoView({block:'start'});
}
function showGenerationFeedback(){
 const panel=$('#generationStatus');if(!panel)return;
 panel.hidden=false;panel.setAttribute('role','alert');panel.innerHTML=$('#previewContent').innerHTML;panel.scrollIntoView({block:'start'});
}
function bindGenerationButtons(){
 document.querySelectorAll('[data-generate]').forEach(button=>button.onclick=async()=>{
  const label=button.textContent;button.disabled=true;button.textContent='Generating final Set '+button.dataset.set+'…';showGenerationProgress(button.dataset.set);
  try{
   const result=await post('/generate',{department_id:Number(button.dataset.generate),set_name:button.dataset.set});generatedDepartmentKey=result.department_key||groupKey(dep(Number(button.dataset.generate)));page='generated';render();message('Paper generated successfully.');showGeneratedPaper(result);
  }catch(e){
   if(e.details?.generation_issues)showGenerationIssues(e.details.generation_issues,button.dataset.set);
   else if(e.details?.screening)showScreening(e.details.screening,true,'generate');
   else if(e.details?.template)showTemplateErrors(e.details.template);
   else showGenerationFailure(button.dataset.set,e.message);
   showGenerationFeedback();
  }finally{button.disabled=false;button.textContent=label;}
 });
}
let generatedLoadVersion=0;
async function loadGeneratedPapers(){
 const version=++generatedLoadVersion;
 $('#content').innerHTML='<div class="panel"><h2>Final question papers</h2><p role="status">Loading saved Set A and Set B…</p></div>';
 try{
  const papers=await api('/generations');
  if(page!=='generated'||version!==generatedLoadVersion)return;
  state.generations=papers;$('#content').innerHTML=generationHistory();bind();
 }catch(e){
  if(page!=='generated'||version!==generatedLoadVersion)return;
  $('#content').innerHTML=`<div class="panel"><h2>Saved papers could not be loaded</h2><p>${escape(e.message)}</p><button id="retryGenerated">Try again</button></div>`;
  $('#retryGenerated').onclick=()=>loadGeneratedPapers();
 }
}

function sectionLabel(value){return value==='research'?'RM':value==='subject'?'Subject':'';}
function formattingRemarks(report){
 const remarks=report.option_errors||[];
 if(!remarks.length)return '';
 return `<section class="formatting-remarks"><h3>Formatting remarks · advisory</h3><p>These remarks do not block uploading or repeat screening. The administrator should check the original Word document.</p><div class="table-wrap"><table><thead><tr><th>Question</th><th>Remark</th><th>Labels detected</th><th>Suggested format</th></tr></thead><tbody>${remarks.map(e=>`<tr><td>${sectionLabel(e.section)} Question ${escape(e.question)}${questionExcerpt(e)}</td><td>${e.missing?`Option label(s) ${escape(e.missing)} were not detected. Check whether they are missing or written differently.`:escape(e.problem)}</td><td>${escape(e.detected||'None')}</td><td>${escape(e.expected||'A) … B) … C) … D) …')}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function questionExcerpt(i){return i.question_text?'<span class="question-excerpt">'+escape(i.question_text)+'</span>':'';}
function answerEvidence(i){
 if(!i.option_counts)return '';
 const key=i.key_answers?.length?'Key question '+i.key_question+': '+(i.key_answers.includes('invalid')?i.key_raw_values||i.key_answers:i.key_answers).join(', '):'No readable key entry at question '+i.key_question;
 const bold=i.bold_options?.length?'Bold answer text: '+i.bold_options.join(', '):'No single fully bold option detected';
 return '<p>'+escape(key)+'<br>'+escape(bold)+'<br>'+escape('Option labels detected: '+Object.entries(i.option_counts).map(([label,count])=>label+' × '+count).join(', '))+'</p>'+ (i.options?.length?'<details><summary>Show detected option text</summary>'+i.options.map(o=>'<p><strong>'+escape(o.label)+')</strong> '+escape(o.text)+'</p>').join('')+'</details>':'');
}
function structureSummary(report){
 const remarks=[...(report.errors||[]),...(report.warnings||[])];
 return `<h3>Template remarks · advisory for submission</h3><p>Expected: ${escape(report.expected)}. Template mismatches do not prevent uploading or admin review.</p>${report.counts?`<p>Detected: ${report.counts.research} RM / ${report.counts.subject} subject${report.counts.unclassified?` / ${report.counts.unclassified} section unspecified`:''}.</p>`:''}${remarks.length?`<div class="table-wrap"><table><thead><tr><th>Check</th><th>Remark</th></tr></thead><tbody>${remarks.map((r,i)=>`<tr><td>${i+1}</td><td>${escape(r)}</td></tr>`).join('')}</tbody></table></div>`:'<p>Question count and section checks passed.</p>'}${formattingRemarks(report)}${report.answer_errors?.length?`<h3>Answer remarks · advisory for submission</h3><p>These are automatic reading results, not a judgement that the answer is wrong. Compare the question and detected text with the original Word file. Uploading and admin review remain available.</p><div class="table-wrap"><table><thead><tr><th>Question in Word file</th><th>Detected evidence and remark</th></tr></thead><tbody>${report.answer_errors.map(i=>`<tr><td>${sectionLabel(i.section)} Question ${escape(i.question)}${questionExcerpt(i)}</td><td>${escape(i.remark)}${answerEvidence(i)}</td></tr>`).join('')}</tbody></table></div>`:''}`;
}
function screeningTable(report){
 return `<section class="screening">${report.submission_note?`<h3>HoD / coordinator remark</h3><p>${escape(report.submission_note)}</p>`:''}<h3>${report.matched_count} of ${report.total_questions??50} uploaded questions match past papers</h3><p>Threshold: more than ${report.limit} matched questions rejects the set. A question matched to several past papers counts once.</p>${report.warning?`<p class="hint-box">${escape(report.warning)}</p>`:''}${report.coverage?`<p>Checked ${report.coverage.checked_papers} archive papers containing ${report.coverage.checked_questions} readable questions.</p>`:''}${report.matches.length?`<div class="table-wrap"><table><thead><tr><th>Uploaded set / question</th><th>Uploaded question</th><th>Past session / campus / set</th><th>Past question</th><th>Match</th></tr></thead><tbody>${report.matches.map(m=>`<tr><td>Set ${escape(m.upcoming_set)}<br>${sectionLabel(m.upcoming_section)} Question ${escape(m.upcoming_question)}</td><td>${escape(m.upcoming_text)}</td><td>${escape(m.past_session)}<br>${escape(m.past_campus)} · Set ${escape(m.past_set)}<br><small>${escape(m.past_file)}</small></td><td><strong>${sectionLabel(m.past_section)} Question ${escape(m.past_question)}</strong><br>${escape(m.past_text)}</td><td>${escape(m.type)}<br>${m.similarity}% similarity</td></tr>`).join('')}</tbody></table></div>`:'<p>No matches detected in the readable archive questions.</p>'}${report.template?structureSummary(report.template):''}<p class="hint">${escape(report.method)} Similarity is a screening score, not a probability.</p></section>`;
}
function showScreening(report,blocked,action='upload'){
 const title=blocked?(report.rejected?'Too many repeated questions':'Question count or sections need correction'):'Upload accepted — awaiting review';
 const status=blocked?(action==='upload'?'This paper has not been saved.':action==='review'?'This paper has not been approved.':'The final paper has not been generated.'):'Your submission is saved and awaits administrator review.';
 const instruction=blocked?(report.rejected?'Replace the matched questions with fresh questions and submit again.':'Correct the detected question count or section headings and submit again.'):'';
 $('#previewContent').innerHTML=`<h2>${title}</h2><p>${status} ${instruction}</p>${screeningTable(report)}`;
 if(!$('#preview').open)$('#preview').showModal();
}
function showTemplateErrors(report){$('#previewContent').innerHTML=`<h2>Question count or sections need correction</h2><p>Your file has not been saved.</p>${structureSummary(report)}`;if(!$('#preview').open)$('#preview').showModal();}
function showGenerationIssues(issues,set=''){$('#previewContent').innerHTML=`<h2>${set?'Final Set '+escape(set):'Final paper'} could not be generated</h2><p>Your submissions remain saved and approved. The table identifies the source papers that need correction before a complete paper and matching answer key can be produced.</p><div class="table-wrap"><table><thead><tr><th>Source paper</th><th>Question</th><th>What needs correction</th></tr></thead><tbody>${issues.map(i=>`<tr><td>${escape(i.filename)}<br>${escape(i.campus)} · ${escape(i.department)} · Set ${escape(i.set)}</td><td>${sectionLabel(i.section)} ${i.section?'Question ':''}${escape(i.question)}${questionExcerpt(i)}</td><td>${escape(i.remark)}${answerEvidence(i)}</td></tr>`).join('')}</tbody></table></div>`;if(!$('#preview').open)$('#preview').showModal();}
function showGenerationFailure(set,reason){$('#previewContent').innerHTML=`<h2>Final Set ${escape(set)} was not generated</h2><p>${escape(reason)}</p><p>Previously saved final papers are available in Generated papers.</p><button data-nav="generated">Open generated papers</button>`;if(!$('#preview').open)$('#preview').showModal();}
function showGeneratedPaper(result){$('#previewContent').innerHTML=`<h2>Question paper generated</h2>${result.template_name?`<p>Admin template: <strong>${escape(result.template_name)}</strong></p>`:''}<p>${escape(result.question_count)} questions with bold correct options and a matching answer-key table.</p>${result.section_distribution?sectionDistributionTable(result.section_distribution):''}${result.common_rm?.length?`<p>Common Research Methodology included automatically:</p><ul>${result.common_rm.map(c=>`<li>${escape(c.campus)} · ${escape(c.category)} · ${escape(c.coordinator)}</li>`).join('')}</ul>`:''}<p><a class="button" href="/api/generations/${result.id}/download">Download generated Word paper</a> <button data-source-record="${escape(result.id)}">View source record</button></p><p>This paper is saved in the Generated papers tab. Open that tab whenever you need it.</p><button data-nav="generated">Open generated papers</button>`;if(!$('#preview').open)$('#preview').showModal();}
