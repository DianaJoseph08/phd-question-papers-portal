const {test}=require('node:test'),assert=require('node:assert/strict');
const {setFromFilename,selectFileSet}=require('./public/upload-set');
test('set detection recognizes the uploaded Vani filenames and common separators',()=>{
 for(const name of ['Rmp_All Department _Jan_2027_QP_Set_B.docx','Exam Set B.docx','Exam-set-b-final.docx','Exam_SetB (2).docx'])assert.equal(setFromFilename(name),'B');
 assert.equal(setFromFilename('Rmp_All Department _Jan_2027_QP_Set_A.docx'),'A');
});
test('set detection does not infer an ambiguous or unrelated filename',()=>{for(const name of ['Questions.docx','Dataset_B.docx','SET_Biology.docx','Set_A_and_Set_B.docx'])assert.equal(setFromFilename(name),null);});
test('choosing a clearly named file selects its set; unmarked files preserve the choice',()=>{
 const fields={file:{files:[{name:'Rmp_All Department _Jan_2027_QP_Set_B.docx'}]},set_name:{value:'A'}};const form={elements:{namedItem:name=>fields[name]}};
 assert.equal(selectFileSet(form),'B');assert.equal(fields.set_name.value,'B');fields.file.files=[{name:'Questions.docx'}];assert.equal(selectFileSet(form),null);assert.equal(fields.set_name.value,'B');
});
