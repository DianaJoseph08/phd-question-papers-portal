function departmentsPage(){
 const added=state.departments.filter(d=>d.is_custom);
 return `<div class="grid"><section class="panel"><h2>Add a department</h2><p>Add departments taking part in the examination, then upload their past papers. For a shared paper across campuses, use the same department name and faculty category.</p><form id="departmentCreate"><label>Department name<input name="name" required minlength="2" maxlength="120" placeholder="e.g. Civil Engineering"></label><label>Campus<select name="campus_id"><option value="1">Ramapuram</option><option value="2">Trichy</option></select></label><label>Faculty / institution<select name="institution_id" required></select></label><label>HoD account (optional)<select name="hod_user_id"></select></label><p class="hint">You can upload past papers immediately. Assign an existing HoD account to enable January 2027 submissions for this department.</p><p class="hint-box" id="departmentFormat"></p><button>Add department</button></form></section><section class="panel"><h2>New departments</h2>${added.length?`<div class="table-wrap"><table><thead><tr><th>Department / campus</th><th>HoD</th><th>Actions</th></tr></thead><tbody>${added.map(d=>`<tr><td><strong>${escape(d.name)}</strong><br>${escape(d.campus)}<br><small>${escape(d.institution)}</small></td><td>${escape(d.hod_name||'Not assigned')}<br><small>${escape(d.submission_format)}</small></td><td><button data-department-upload="${d.id}">Upload past papers</button></td></tr>`).join('')}</tbody></table></div>`:'<p>No new departments added yet.</p>'}</section></div>`;
}
function openArchiveUpload(id){page='upload';render();$('#paperUpload select[name="department_id"]').value=String(id);}
function bindDepartments(){
 document.querySelectorAll('[data-department-upload]').forEach(b=>b.onclick=()=>openArchiveUpload(b.dataset.departmentUpload));
 const form=$('#departmentCreate');if(!form)return;
 function formatHint(){
  const faculty=state.institutions.find(i=>i.id===Number(form.elements.institution_id.value));
  const coordinator=dep(faculty?.common_rm_id);
  $('#departmentFormat').textContent=faculty?.common_rm_id?`HoD submits 25 subject questions. Common RM is supplied by ${coordinator.coordinator_name||'the assigned research coordinator'}. A complete 25 RM + 25 subject paper is also accepted.`:'HoD submits 25 Research Methodology and 25 subject questions.';
 }
 function campusChoices(){
  const campus=Number(form.elements.campus_id.value);
  form.elements.institution_id.innerHTML=state.institutions.filter(i=>i.campus_id===campus).map(i=>`<option value="${i.id}">${escape(i.name)}</option>`).join('');
  form.elements.hod_user_id.innerHTML='<option value="">No HoD assigned</option>'+state.hod_accounts.filter(u=>u.campus_id===campus).map(u=>`<option value="${u.id}">${escape(u.name)} (${escape(u.username)})</option>`).join('');
  formatHint();
 }
 campusChoices();form.elements.campus_id.onchange=campusChoices;form.elements.institution_id.onchange=formatHint;
 form.onsubmit=async e=>{
  e.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{const result=await post('/departments',Object.fromEntries(new FormData(form)));await refresh();openArchiveUpload(result.department.id);message('Department added. Upload its January or July 2026 papers below.');}
  catch(error){message(error.message);}finally{button.disabled=false;}
 };
}
