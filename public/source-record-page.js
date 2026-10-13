const $=selector=>document.querySelector(selector);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function loadSourceRecordPage(){
 const id=window.location.pathname.match(/\/generations\/([^/]+)\/manifest\/?$/)?.[1];
 try{
  if(!id)throw Error('Open a source record from the Generated papers tab.');
  const response=await fetch(`/api/generations/${encodeURIComponent(id)}/manifest?format=json`,{headers:{Accept:'application/json'}}),record=await response.json();
  if(!response.ok)throw Error(record.error||'The source record could not be opened.');
  $('#sourcePageContent').innerHTML=sourceRecordHtml(record);bindSourceRecordFilters(record);
  $('#sourceBack').href='/?view=generated'+(record.department_key?'&department='+encodeURIComponent(record.department_key):'');
  document.title=`${record.department_name} · Set ${record.set_name} source record | SRMIST`;
 }catch(e){$('#sourcePageContent').innerHTML=`<h2>Source record unavailable</h2><p>${escape(e.message)}</p><a class="button" href="/">Sign in to the portal</a>`;}
}
loadSourceRecordPage();
