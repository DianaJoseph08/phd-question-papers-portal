const test=require('node:test'),assert=require('node:assert/strict'),Zip=require('pizzip');
const {inspect}=require('./papers'),{inspectForDepartment}=require('./submission-policy'),{layout,markedQuestion}=require('./answers');
const p=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const cell=t=>'<w:tc>'+p(t)+'</w:tc>',row=a=>'<w:tr>'+a.map(cell).join('')+'</w:tr>';
function doc(body){const z=new Zip();z.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);return z.generate({type:'nodebuffer'});}
const question=(number,stem='Which result applies?')=>p(`${number}. ${stem} A) alpha B) beta C) gamma D) delta`);
test('full template key numbering follows RM and subject order even when source numbers restart',()=>{
 let body='';for(const heading of ['Research Methodology','Subject-Specific Questions']){body+=p(heading);for(let i=1;i<=25;i++)body+=question(i);}
 body+=p('Answer Key AA')+'<w:tbl>'+row(['Question No.','Correct Option','Question No.','Correct Option']);for(let i=1;i<=25;i++)body+=row([i,'A',i+25,'D']);body+='</w:tbl>';
 const qs=inspect(doc(body)).questions;assert.equal(qs.length,50);assert.ok(qs.slice(0,25).every(q=>q.answer==='A'));assert.ok(qs.slice(25).every(q=>q.answer==='D'));assert.equal(qs[25].answer_key_number,26);
});
test('subject-only key supports template positions 26-50 including inferred department sections',()=>{
 let body='';for(let i=1;i<=25;i++)body+=question(i);body+=p('Answer Key')+'<w:tbl>';for(let i=1;i<=25;i++)body+=row([i,'',i+25,'C']);body+='</w:tbl>';
 const qs=inspectForDepartment(doc(body),{name:'Chemistry',common_rm_id:201}).questions;assert.ok(qs.every(q=>q.section==='subject'&&q.answer==='C'));assert.equal(qs[0].answer_key_number,26);
});
test('scoped answer keys distinguish repeated RM and subject question numbers',()=>{
 const body=p('Research Methodology')+question(1)+p('Subject-Specific Questions')+question(1)+p('Answer Key Research Methodology')+p('1 B')+p('Answer Key Subject')+p('1 D');
 assert.deepEqual(inspect(doc(body)).questions.map(q=>q.answer),['B','D']);
});
test('ambiguous, conflicting and invalid keys never silently invent answers',()=>{
 for(const key of [p('1 A')+p('1 B'),'<w:tbl>'+row([1,'(Example:) A'])+'</w:tbl>']){const q=inspect(doc(p('Subject-Specific Questions')+question(1)+p('Answer Key')+key)).questions[0];assert.equal(q.answer,null);assert.match(q.answer_error,/invalid|conflicting/);}
 const full=inspect(doc(p('Research Methodology')+question(1)+p('Subject-Specific Questions')+question(1)+p('Answer Key')+p('1 B')));assert.ok(full.questions.every(q=>q.answer===null&&/without identifying/.test(q.answer_error)));
});
test('a uniquely bold option is inferred, label-only bold is insufficient, key disagreements are reported',()=>{
 const stem=p('Subject-Specific Questions')+p('1. Which result applies?');const opt=(label,boldBody)=>`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${label}) </w:t></w:r><w:r>${boldBody?'<w:rPr><w:b/></w:rPr>':''}<w:t>option ${label}</w:t></w:r></w:p>`;
 const body=stem+['A','B','C','D'].map(a=>opt(a,a==='C')).join('');assert.equal(inspect(doc(body)).questions[0].answer,'C');assert.match(inspect(doc(body+p('Answer Key')+p('1 A'))).questions[0].answer_error,/disagree/);
 const noAnswer=inspect(doc(stem+['A','B','C','D'].map(a=>opt(a,false)).join(''))).questions[0];assert.equal(noAnswer.answer,null);
});
test('marking splits mixed option runs, clears other bold and removes split typed source numbers',()=>{
 const xml='<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>1</w:t></w:r><w:r><w:t>2. Which result? A) alpha B) beta C) gamma D) delta</w:t></w:r></w:p>';
 const result=markedQuestion(xml,'B',12),l=layout(result);assert.ok(l.text.startsWith('Which result?'));assert.equal(l.options.length,4);
 for(const o of l.options){const runs=l.runs.filter(r=>r.end>o.body&&r.start<o.end&&r.text.slice(Math.max(0,o.body-r.start),Math.min(r.text.length,o.end-r.start)).trim());assert.ok(runs.every(r=>r.node.getElementsByTagName('w:b')[0].getAttribute('w:val')===(o.label==='B'?'1':'0')));}
});
test('equations, inline drawings and numbering-independent option text survive answer marking',()=>{
 const xml='<w:p xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:r><w:t>1. Which value? A) alpha B) beta C) gamma D) delta</w:t></w:r><m:oMath><m:r><m:t>x=2</m:t></m:r></m:oMath><w:r><w:drawing/></w:r></w:p>';
 const result=markedQuestion(xml,'D');assert.ok(result.includes('m:oMath'));assert.ok(result.includes('x=2'));assert.ok(result.includes('w:drawing'));
});
test('common RM keys ignore blank unused subject rows',()=>{
 let body=p('Research Methodology');for(let i=1;i<=25;i++)body+=question(i);body+=p('AAAnswer Key')+'<w:tbl>';for(let i=1;i<=25;i++)body+=row([i,'B',i+25,'']);body+='</w:tbl>';assert.ok(inspect(doc(body)).questions.every(q=>q.answer==='B'));
});
test('automatic numbering never removes a numerical value from the question stem',()=>{
 const xml=p('25 students were sampled. Which result? A) alpha B) beta C) gamma D) delta');assert.ok(layout(markedQuestion(xml,'A',null)).text.startsWith('25 students'));
});
