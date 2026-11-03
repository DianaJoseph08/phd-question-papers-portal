const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Zip=require('pizzip');
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const {examCopy}=require('./exam-copy'),{inspect,generate,text}=require('./papers'),{templateFixture}=require('./test-template');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
function generated(t,{common=false,set='A',columns=4}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qp-exam-copy-'));t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 let body='';
 for(const section of common?['Research Methodology']:['Research Methodology','Subject-Specific Questions']){
  body+=paragraph(section);
  for(let i=1;i<=25;i++)body+=`<w:p><w:r><w:t>${i}. Which result applies to ${section} sample ${i}? A) alpha B) </w:t></w:r><m:oMath><m:r><m:rPr><m:sty m:val="b"/></m:rPr><m:t>x=2</m:t></m:r></m:oMath><w:r><w:t> C) gamma D) delta</w:t></w:r></w:p>`;
 }
 body+=paragraph('Answer Key');for(let i=1;i<=(common?25:50);i++)body+=paragraph(i+' B');
 const source=new Zip();source.file('word/document.xml',`<w:document xmlns:w="${W}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}</w:body></w:document>`);
 const buffer=source.generate({type:'nodebuffer'}),file=path.join(directory,'source.docx');fs.writeFileSync(file,buffer);
 const selected=inspect(buffer).questions.map(q=>({...q,source:{path:file}})),template=new Zip(templateFixture(set,{columns}));
 template.file('word/media/logo.png',Buffer.from('template-image-fixture'));template.file('customXml/item1.xml','<template-metadata/>');
 return generate(selected,'Mechanical Engineering',set,template.generate({type:'nodebuffer'}),{facultyName:'Faculty of Engineering and Technology'});
}
function optionRuns(question){
 const {layout}=require('./answers'),l=layout(question.xml);
 return l.runs.filter(r=>l.options.some(o=>r.end>o.start&&r.start<o.end)||(!r.text&&r.start>=l.options[0].start));
}
test('full Set A/B exam copies keep the exact questions/order and package assets but expose no answers',t=>{
 for(const set of ['A','B']){
  const marked=generated(t,{set}),snapshot=Buffer.from(marked),original=inspect(marked),output=examCopy(marked),exam=inspect(output),source=new Zip(marked),copy=new Zip(output);
  assert.deepEqual(exam.questions.map(q=>q.text),original.questions.map(q=>q.text));assert.deepEqual(exam.counts,{research:25,subject:25});assert.ok(exam.questions.every(q=>q.answer===null));
  assert.ok(!copy.file('word/document.xml').asText().includes('Answer Key'));assert.ok(!copy.file('word/document.xml').asText().includes('Correct Option'));
  assert.deepEqual(Object.keys(copy.files).sort(),Object.keys(source.files).sort());for(const name of Object.keys(source.files))if(name!=='word/document.xml'&&!source.files[name].dir)assert.deepEqual(copy.file(name).asNodeBuffer(),source.file(name).asNodeBuffer(),name);
  for(const q of exam.questions)for(const r of optionRuns(q)){
   for(const tag of ['w:b','w:bCs'])assert.equal(r.node.getElementsByTagName(tag)[0]?.getAttribute('w:val'),'0');
   assert.ok(Array.from(r.node.getElementsByTagName('m:sty')).every(n=>!['b','bi'].includes(n.getAttribute('m:val'))));
  }
  assert.deepEqual(marked,snapshot);assert.ok(inspect(marked).questions.every(q=>q.answer==='B'));
 }
});
test('25-question Common RM papers and two-column answer keys also support exam copies',t=>{
 for(const options of [{common:true},{columns:2}]){
  const marked=generated(t,options),plain=examCopy(marked),exam=inspect(plain);
  assert.equal(exam.questions.length,options.common?25:50);assert.ok(exam.questions.every(q=>q.answer===null));assert.ok(!new Zip(plain).file('word/document.xml').asText().includes('Correct Option'));
 }
});
test('headings, question emphasis, mathematical italics and body notes after the key are preserved',t=>{
 const zip=new Zip(generated(t)),doc=new DOMParser().parseFromString(zip.file('word/document.xml').asText(),'application/xml');
 const heading=Array.from(doc.getElementsByTagName('w:p')).find(p=>text(p)==='Research Methodology');
 const bold=doc.createElementNS(W,'w:b');heading.getElementsByTagName('w:rPr')[0].appendChild(bold);
 const stem=Array.from(doc.getElementsByTagName('w:p')).find(p=>/^1\.\s*Which/.test(text(p)));
 for(const pr of Array.from(stem.getElementsByTagName('w:rPr')))for(const b of Array.from(pr.getElementsByTagName('w:b')))b.setAttribute('w:val','1');
 for(const style of Array.from(doc.getElementsByTagName('m:sty')))style.setAttribute('m:val','bi');
 const note=doc.createElementNS(W,'w:p'),run=doc.createElementNS(W,'w:r'),value=doc.createElementNS(W,'w:t');value.textContent='End of examination';run.appendChild(value);note.appendChild(run);const body=doc.getElementsByTagName('w:body')[0];body.insertBefore(note,doc.getElementsByTagName('w:sectPr')[0]);
 zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));const copy=new Zip(examCopy(zip.generate({type:'nodebuffer'}))),examDoc=new DOMParser().parseFromString(copy.file('word/document.xml').asText(),'application/xml');
 assert.equal(Array.from(examDoc.getElementsByTagName('w:p')).find(p=>text(p)==='Research Methodology').getElementsByTagName('w:b')[0].getAttribute('w:val'),'');
 assert.ok(Array.from(examDoc.getElementsByTagName('w:p')).find(p=>/^1\.\s*Which/.test(text(p))).getElementsByTagName('w:b')[0].getAttribute('w:val')==='1');
 assert.ok(Array.from(examDoc.getElementsByTagName('m:sty')).every(s=>s.getAttribute('m:val')==='i'));assert.ok(copy.file('word/document.xml').asText().includes('End of examination'));
 assert.equal(examDoc.getElementsByTagName('w:sectPr').length,1);assert.ok(copy.file('word/document.xml').asText().includes('w:top="1800"'));
});
test('older inline question/option runs and paragraph answer keys retain stem emphasis while hiding answers',()=>{
 const zip=new Zip();zip.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body>${paragraph('Research Methodology')}<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>1. Choose the result that does NOT apply? A) alpha B) beta C) gamma D) delta</w:t></w:r></w:p>${paragraph('Answer Key')}${paragraph('1 A')}<w:sectPr/></w:body></w:document>`);
 const marked=zip.generate({type:'nodebuffer'}),plain=examCopy(marked),exam=inspect(plain);assert.equal(exam.questions[0].answer,null);assert.equal(exam.questions[0].text,inspect(marked).questions[0].text);
 const xml=new Zip(plain).file('word/document.xml').asText();assert.ok(xml.includes('NOT apply?'));assert.ok(!xml.includes('Answer Key'));assert.ok(exam.questions[0].xml.includes('<w:b/>'));
});
test('missing keys or unsupported layouts fail instead of downloading an exam copy that leaks answers',t=>{
 const zip=new Zip(generated(t));zip.file('word/document.xml',zip.file('word/document.xml').asText().replace('Answer Key','Answer section missing'));
 assert.throws(()=>examCopy(zip.generate({type:'nodebuffer'})),/answer-key section could not be located|unsupported option layout/);
 const blank=new Zip();blank.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body>${paragraph('No questions')}</w:body></w:document>`);assert.throws(()=>examCopy(blank.generate({type:'nodebuffer'})),/no readable questions/);
});
test('DOM references are opt-in and never appear in the normal parser/API result',t=>{
 const marked=generated(t),normal=inspect(marked);assert.equal('document' in normal,false);assert.ok(normal.questions.every(q=>!('paragraphs' in q)));assert.doesNotThrow(()=>JSON.stringify(normal));
});
