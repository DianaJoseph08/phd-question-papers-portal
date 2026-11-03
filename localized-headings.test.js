const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),Zip=require('pizzip');
const {inspect,generate}=require('./papers'),{inspectForDepartment,validateTemplate}=require('./submission-policy'),{examCopy}=require('./exam-copy'),{templateFixture}=require('./test-template'),{tamilSectionHeading}=require('./localized-headings');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',p=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
function fixture({sections=['research','subject'],scoped=false,keyTitle='விடைக்குறிப்பு',subjectTitle='தமிழ் இலக்கிய வரலாறு'}={}){
 const z=new Zip();let body='',definitions='<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>',serial=0;
 const titles={research:'ஆராய்ச்சி நெறிமுறைகள்',subject:subjectTitle},numbered=(value,id,bold=false)=>`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r>${bold?'<w:rPr><w:b/><w:bCs/></w:rPr>':''}<w:t>${value}</w:t></w:r></w:p>`;
 for(const section of sections){
  const id=section==='research'?1:2,start=section==='subject'&&!scoped?26:1;definitions+=`<w:num w:numId="${id}"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`;body+=p(titles[section])+p('(25×1=25)');
  for(let n=1;n<=25;n++){
   body+=numbered((section==='research'?'ஆய்வின்':'இலக்கியத்தின்')+' மாதிரி '+n+' பற்றிய வினா',id);const optionId=100+(++serial),answer=scoped&&section==='subject'?'C':'B';
   definitions+=`<w:abstractNum w:abstractNumId="${optionId}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/></w:lvl></w:abstractNum><w:num w:numId="${optionId}"><w:abstractNumId w:val="${optionId}"/></w:num>`;
   ['முதல் தெரிவு','இரண்டாம் தெரிவு','மூன்றாம் தெரிவு','நான்காம் தெரிவு'].forEach((value,i)=>body+=numbered(value,optionId,'ABCD'[i]===answer));
  }
 }
 if(scoped){for(const section of sections){body+=p(keyTitle+': '+titles[section]);for(let n=1;n<=25;n++)body+=p(n+' '+(section==='subject'?'C':'B'));}}
 else{body+=p(keyTitle);for(const section of sections)for(let n=1;n<=25;n++)body+=p((section==='subject'?n+25:n)+' B');}
 z.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);z.file('word/numbering.xml',`<w:numbering xmlns:w="${W}">${definitions}</w:numbering>`);return z.generate({type:'nodebuffer'});
}
test('Tamil RM and literature headings classify all 50 automatic questions and retain Tamil key answers',()=>{
 const buffer=fixture(),d={name:'Tamil'},info=inspectForDepartment(buffer,d),v=validateTemplate(buffer,d,info);assert.deepEqual(info.counts,{research:25,subject:25});assert.equal(info.valid,true);assert.equal(info.questions[25].source_number,26);assert.ok(info.questions.every(q=>q.answer==='B'&&!q.answer_error));assert.deepEqual(v.errors,[]);assert.deepEqual(v.option_errors,[]);assert.deepEqual(v.answer_errors,[]);assert.deepEqual(v.warnings,[]);
});
test('the shorter Tamil Set A literature heading ends RM at question 25 and scopes restarted subject keys',()=>{
 for(const scoped of [false,true])for(const campus_id of [1,2]){
  const buffer=fixture({subjectTitle:'இலக்கிய வரலாறு',scoped}),d={name:'Tamil',campus_id},info=inspectForDepartment(buffer,d),v=validateTemplate(buffer,d,info);assert.deepEqual(info.counts,{research:25,subject:25});assert.equal(info.questions[24].section,'research');assert.equal(info.questions[25].section,'subject');assert.equal(info.questions[25].source_number,scoped?1:26);assert.ok(info.questions.every(q=>q.answer&&!q.answer_error));assert.deepEqual(v.errors,[]);assert.deepEqual(v.answer_errors,[]);
 }
 assert.equal(tamilSectionHeading('இலக்கிய வரலாறு பற்றி விளக்குக'),null);
});
test('Tamil subject-only and Common RM papers follow the same assigned-paper rules on either campus',()=>{
 for(const campus_id of [1,2]){
  const subject=inspectForDepartment(fixture({sections:['subject']}),{campus_id,common_rm_id:200+campus_id,name:'Tamil'}),common=inspectForDepartment(fixture({sections:['research']}),{campus_id,is_common:true});assert.deepEqual(subject.counts,{research:0,subject:25});assert.equal(subject.valid,true);assert.deepEqual(common.counts,{research:25,subject:0});assert.equal(common.valid,true);
 }
});
test('Tamil scoped key headings and mixed English/Tamil headings disambiguate restarted section numbers',()=>{
 for(const keyTitle of ['விடைக் குறிப்புகள்','Answer Key']){
  const info=inspect(fixture({scoped:true,keyTitle}));assert.deepEqual(info.counts,{research:25,subject:25});assert.ok(info.questions.slice(0,25).every(q=>q.answer==='B'&&!q.answer_error));assert.ok(info.questions.slice(25).every(q=>q.answer==='C'&&!q.answer_error));assert.equal(info.questions[25].source_number,1);assert.equal(info.questions[25].answer_key_number,1);
 }
});
test('Tamil heading recognition handles marks and section labels without classifying ordinary prose',()=>{
 for(const value of ['பகுதி அ: ஆய்வு முறையியல் (25 வினாக்கள்)','Section A: ஆராய்ச்சி நெறிமுறைகள்'])assert.equal(tamilSectionHeading(value),'research');
 for(const value of ['பகுதி ஆ: பாடம் சார்ந்த வினாக்கள்','தமிழ் இலக்கிய வரலாறு (25×1=25)'])assert.equal(tamilSectionHeading(value),'subject');
 for(const value of ['ஆராய்ச்சி நெறிமுறைகள் பற்றி விளக்குக','இலக்கியத்தின் மாதிரி பற்றிய வினா','The words தமிழ் இலக்கிய வரலாறு occur in this question'])assert.equal(tamilSectionHeading(value),null);
});
test('genuine disagreements between Tamil paper key entries and bold answers remain visible',()=>{
 const z=new Zip(fixture());z.file('word/document.xml',z.file('word/document.xml').asText().replace('<w:t>26 B</w:t>','<w:t>26 A</w:t>'));const q=inspect(z.generate({type:'nodebuffer'})).questions[25];assert.equal(q.answer,null);assert.match(q.answer_error,/key question 26 says A; option B/);
});
test('Tamil administrator headings and key-table labels survive generation; exam copies remove the Tamil key',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qp-tamil-'));t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 const buffer=fixture(),file=path.join(directory,'tamil.docx');fs.writeFileSync(file,buffer);const selected=inspect(buffer).questions.map(q=>({...q,source:{path:file}}));
 const template=new Zip(templateFixture('B'));template.file('word/document.xml',template.file('word/document.xml').asText().replaceAll('Research Methodology','ஆராய்ச்சி நெறிமுறைகள்').replaceAll('Subject-Specific Questions','இலக்கிய வரலாறு').replaceAll('Answer Key','விடைக்குறிப்பு').replaceAll('Question No.','வினா எண்').replaceAll('Correct Option','சரியான விடை'));
 const output=generate(selected,'Tamil','B',template.generate({type:'nodebuffer'})),info=inspect(output);assert.deepEqual(info.counts,{research:25,subject:25});assert.ok(info.questions.every(q=>q.answer==='B'&&!q.answer_error));assert.ok(new Zip(output).file('word/document.xml').asText().includes('வினா எண்'));
 const candidate=examCopy(output),exam=inspect(candidate);assert.deepEqual(exam.counts,{research:25,subject:25});assert.ok(exam.questions.every(q=>q.answer===null));assert.ok(!new Zip(candidate).file('word/document.xml').asText().includes('விடைக்குறிப்பு'));assert.deepEqual(fs.readFileSync(file),buffer);
});
