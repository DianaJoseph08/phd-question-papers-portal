const {test}=require('node:test'),assert=require('node:assert/strict');
const {setFromFilename,selectFileSet,wordFileError}=require('./public/upload-set');
test('set detection recognizes the uploaded Vani filenames and common separators',()=>{
 for(const name of ['Rmp_All Department _Jan_2027_QP_Set_B.docx','Exam Set B.docx','Exam-set-b-final.docx','Exam_SetB (2).docx'])assert.equal(setFromFilename(name),'B');
 assert.equal(setFromFilename('Rmp_All Department _Jan_2027_QP_Set_A.docx'),'A');
});
test('set detection does not infer an ambiguous or unrelated filename',()=>{for(const name of ['Questions.docx','Dataset_B.docx','SET_Biology.docx','Set_A_and_Set_B.docx'])assert.equal(setFromFilename(name),null);});
test('choosing a clearly named file selects its set; unmarked files preserve the choice',()=>{
 const fields={file:{files:[{name:'Rmp_All Department _Jan_2027_QP_Set_B.docx'}]},set_name:{value:'A'}};const form={elements:{namedItem:name=>fields[name]}};
 assert.equal(selectFileSet(form),'B');assert.equal(fields.set_name.value,'B');fields.file.files=[{name:'Questions.docx'}];assert.equal(selectFileSet(form),null);assert.equal(fields.set_name.value,'B');
});
test('Word file errors distinguish old .doc from supported .docx and explain how to convert',()=>{
 for(const name of ['Cardiac_Set_B.docx','Cardiac_Set_B.DOCX'])assert.equal(wordFileError(name),null);
 assert.match(wordFileError('Cardiac_Set_B.doc'),/Save As > Word Document \(\.docx\)/);
 assert.match(wordFileError('Cardiac_Set_B.doc'),/Renaming .doc to .docx does not convert/);
 assert.match(wordFileError('Cardiac_Set_B.pdf'),/PDF, image/);
});
function uploadUi({failure,refreshFailure,screening}={}){
 const vm=require('node:vm'),fs=require('node:fs'),app=fs.readFileSync(require.resolve('./public/app'),'utf8');
 const fields={file:{files:[{name:'Cardiac_Set_B.doc'}]}},button={disabled:false},form={id:'paperUpload',elements:{namedItem:name=>fields[name]},querySelector:()=>button,after:panel=>{nodes['#'+panel.id]=panel;}};
 const nodes={'#paperUpload':form,'#openUploadScreening':{}},messages=[],reports=[];let refreshes=0;
 const context=vm.createContext({document:{createElement:()=>({setAttribute(){}})},$:selector=>nodes[selector],escape:s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  FormData:class{set(){}},api:async()=>{if(failure)throw Object.assign(Error(failure),{details:screening?{screening}:undefined});return {set_name:'B'};},
  refresh:async()=>{refreshes++;if(refreshFailure)throw Error('Refresh failed');},message:s=>messages.push(s),showScreening:(report,blocked)=>reports.push({report,blocked}),showTemplateErrors(){}});
 vm.runInContext(app.slice(app.indexOf('function uploadFeedback('),app.indexOf('function bind()')),context);
 return {context,form,button,nodes,messages,reports,refreshes:()=>refreshes};
}
test('upload failures stay visible with the filename and preserve the selected file for retry',async()=>{
 const ui=uploadUi({failure:'Save as .docx; <unsafe> is not supported'});await ui.context.submit(ui.form,'/papers');
 assert.ok(ui.nodes['#uploadFeedback'].innerHTML.includes('Cardiac_Set_B.doc'));assert.ok(ui.nodes['#uploadFeedback'].innerHTML.includes('&lt;unsafe&gt;'));
 assert.equal(ui.form.elements.namedItem('file').files[0].name,'Cardiac_Set_B.doc');assert.equal(ui.refreshes(),0);assert.equal(ui.button.disabled,false);
});
test('repeat rejection keeps the matched-question report available after closing the dialog',async()=>{
 const report={matched_count:11,rejected:true},ui=uploadUi({failure:'11 questions match',screening:report});await ui.context.submit(ui.form,'/papers');
 assert.equal(ui.reports.length,1);assert.equal(ui.reports[0].blocked,true);ui.nodes['#openUploadScreening'].onclick();assert.equal(ui.reports.length,2);assert.equal(ui.reports[1].report,report);
});
test('a failed library refresh after a confirmed upload is not described as an unsaved paper',async()=>{
 const ui=uploadUi({refreshFailure:true});await ui.context.submit(ui.form,'/papers');
 assert.ok(ui.nodes['#uploadFeedback'].innerHTML.includes('Upload saved; library refresh failed'));assert.ok(!ui.nodes['#uploadFeedback'].innerHTML.includes('Upload could not be completed'));
});
