let accountDirectory=[];
const officeDate=value=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'—';
function accountPage(){return `<section class="panel"><h2>Change password</h2><p>This changes your Question Paper Office password. Your username stays the same.</p>${state.user.must_change_password?'<p class="hint-box">Change your temporary password to continue.</p>':''}<form id="passwordChange"><label>Username<input value="${escape(state.user.username)}" readonly></label><p>${escape(state.user.email||'No email address recorded')}</p><label>Current password<input name="current_password" type="password" autocomplete="current-password" maxlength="128" required></label><label>New password<input name="new_password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><label>Confirm new password<input name="confirm_password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><p class="hint">Use 12–128 characters. Other signed-in sessions will be signed out.</p><button>Change password</button></form></section>`;}
function accountsPage(){return `<section class="panel"><h2>User accounts</h2><p>View usernames, email addresses and password status. Passwords are not displayed. To help a user sign in, set a temporary password; they must change it after signing in.</p><label>Find an account<input id="accountSearch" placeholder="Name, username, email or department"></label><div id="accountRows">Loading accounts…</div></section>`;}
function accountRows(search=''){
 const users=accountDirectory.filter(u=>[u.name,u.username,u.email,...u.departments].join(' ').toLowerCase().includes(search.toLowerCase()));
 return `<div class="table-wrap"><table><thead><tr><th>Name / role</th><th>Username</th><th>Email</th><th>Campus / department</th><th>Password status</th><th>Actions</th></tr></thead><tbody>${users.map(u=>`<tr><td>${escape(u.name)}<br><small>${escape(u.role)}</small></td><td>${escape(u.username)}</td><td>${escape(u.email||'Not provided')}</td><td>${u.campus_id===1?'Ramapuram':u.campus_id===2?'Trichy':'All campuses'}<br><small>${u.departments.map(escape).join('<br>')}</small></td><td>${escape(u.password_status)}<br><small>${officeDate(u.password_updated_at)}</small></td><td>${u.role==='super_admin'&&state.user.role!=='super_admin'?'':`<button data-reset-password="${u.id}">Reset password</button>`}</td></tr>`).join('')}</tbody></table></div>`;
}
function passwordResetDialog(id){
 const u=accountDirectory.find(u=>u.id===Number(id));if(!u)return;
 $('#previewContent').innerHTML=`<h2>Reset password</h2><p>Account: <strong>${escape(u.name)} · ${escape(u.username)}</strong>. Their username stays the same. They must change the temporary password after signing in.</p><form id="passwordReset"><label>Your administrator password<input name="current_password" type="password" autocomplete="current-password" required maxlength="128"></label><label>Temporary password<input name="new_password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><label>Confirm temporary password<input name="confirm_password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><button>Reset password</button></form>`;
 $('#preview').showModal();$('#passwordReset').onsubmit=async e=>{
  e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
  try{const result=await post(`/users/${u.id}/reset-password`,Object.fromEntries(new FormData(e.target)));$('#preview').close();if(result.signed_out){$('#app').hidden=true;$('#login').hidden=false;$('#loginForm').reset();message('Your password was reset. Sign in using the temporary password.');}else{render();message('Temporary password saved. The user must change it after signing in.');}}
  catch(error){message(error.message);}finally{button.disabled=false;}
 };
}
function removePaperDialog(id){
 const paper=state.papers.find(p=>p.id===id);if(!paper)return;
 $('#previewContent').innerHTML=`<h2>Remove question paper</h2><p><strong>${escape(paper.original_name)}</strong><br>${escape(dep(paper.department_id).name)} · ${escape(paper.session)} · Set ${escape(paper.set_name)}</p><p>This paper will no longer appear in the library or be used for screening and generation. The removal and your reason will be recorded in the admin activity log.</p><form id="paperRemove"><label>Reason<input name="reason" required minlength="3" maxlength="500"></label><button class="danger">Remove paper</button></form>`;
 $('#preview').showModal();$('#paperRemove').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await post(`/papers/${id}/remove`,Object.fromEntries(new FormData(e.target)));$('#preview').close();await refresh();message('Paper removed. The activity log records who removed it and why.');}catch(error){message(error.message);}finally{button.disabled=false;}};
}
function bindAccounts(){
 document.querySelectorAll('[data-remove-paper]').forEach(b=>b.onclick=()=>removePaperDialog(b.dataset.removePaper));
 const form=$('#passwordChange');if(form)form.onsubmit=async e=>{
  e.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{await post('/password',Object.fromEntries(new FormData(form)));form.reset();await refresh();message('Password changed. Your username is unchanged.');}catch(error){message(error.message);}finally{button.disabled=false;}
 };
 if($('#accountRows'))api('/users').then(result=>{if(!$('#accountRows'))return;accountDirectory=result.users;function show(){const target=$('#accountRows');if(!target)return;target.innerHTML=accountRows($('#accountSearch').value);target.querySelectorAll('[data-reset-password]').forEach(b=>b.onclick=()=>passwordResetDialog(b.dataset.resetPassword));}show();$('#accountSearch').oninput=show;}).catch(error=>message(error.message));
}
