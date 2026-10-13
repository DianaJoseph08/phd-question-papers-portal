const test=require('node:test'),assert=require('node:assert/strict'),Zip=require('pizzip');
const {inspect}=require('./papers'),{inspectForDepartment}=require('./submission-policy'),{layout,markedQuestion}=require('./answers');
const p=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const cell=t=>'<w:tc>'+p(t)+'</w:tc>',row=a=>'<w:tr>'+a.map(cell).join('')+'</w:tr>';
function doc(body){const z=new Zip();z.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);return z.generate({type:'nodebuffer'});}
const question=(number,stem='Which result applies?')=>p(`${number}. ${stem} A) alpha B) beta C) gamma D) delta`);
function numberedDoc(body,definitions){const z=new Zip(doc(body));z.file('word/numbering.xml',`<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${definitions}</w:numbering>`);return z.generate({type:'nodebuffer'});}
const level=(n,fmt,start=1)=>`<w:lvl w:ilvl="${n}"><w:start w:val="${start}"/><w:numFmt w:val="${fmt}"/></w:lvl>`;
const list=(id,levels,override='')=>`<w:abstractNum w:abstractNumId="${id}">${levels}</w:abstractNum><w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/>${override}</w:num>`;
const numbered=(t,id,n,bold=false)=>`<w:p><w:pPr><w:numPr><w:ilvl w:val="${n}"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r>${bold?'<w:rPr><w:b/></w:rPr>':''}<w:t>${t}</w:t></w:r></w:p>`;

test('nested Word decimal questions and numeric letter options retain 50 questions and their correct key positions',()=>{
 let body=p('Research Methodology');for(let n=1;n<=25;n++)body+=question(n);
 body+=p('Subject-Specific Questions');let defs='';
 const groups=[{id:1,n:1,start:26,count:12},{id:2,n:0,start:38,count:5},{id:3,n:2,start:43,count:3},{id:4,n:0,start:46,count:5}];
 for(const g of groups){defs+=list(g.id,level(g.n,'decimal',g.start));for(let n=g.start;n<g.start+g.count;n++){body+=numbered('Which value applies to sample '+n+'?',g.id,g.n);const optId=100+n;defs+=list(optId,level(1,'upperLetter'));for(const [i,value] of ['0.98','20','49','98'].entries())body+=numbered(value,optId,1,i===2);}}
 body+=p('Answer Key');for(let n=1;n<=50;n++)body+=p(n+' C');
 const qs=inspect(numberedDoc(body,defs)).questions;assert.equal(qs.length,50);assert.deepEqual(qs.slice(25).map(q=>q.source_number),Array.from({length:25},(_,i)=>i+26));assert.ok(qs.every(q=>q.answer==='C'&&!q.answer_error));assert.ok(qs.slice(25).every(q=>layout(q.xml).options.length===4));
});
test('numbering overrides are respected and nested option numbering restarts at each decimal question',()=>{
 const defs=list(1,level(0,'decimal')+level(1,'upperLetter'),'<w:lvlOverride w:ilvl="0"><w:startOverride w:val="26"/></w:lvlOverride>');
 let body=p('Subject-Specific Questions');for(let i=0;i<2;i++)body+=numbered('Which value is correct?',1,0)+['20','49','98','2'].map((t,n)=>numbered(t,1,1,n===1)).join('');body+=p('Answer Key')+p('26 B')+p('27 B');
 const qs=inspect(numberedDoc(body,defs)).questions;assert.deepEqual(qs.map(q=>q.source_number),[26,27]);assert.ok(qs.every(q=>q.answer==='B'&&!q.answer_error));assert.equal(qs[0].number,null);
});
test('numeric table question cells do not require correctly labelled options to count the next question',()=>{
 const body=p('Subject-Specific Questions')+'<w:tbl>'+row([1,'Which result? A) alpha B) beta C) gamma D delta'])+row([2,'Which second result? A) alpha B) beta C) gamma D) delta'])+'</w:tbl>';
 assert.deepEqual(inspect(doc(body)).questions.map(q=>q.number),[1,2]);
});
test('scientific references in a stem or option do not create duplicate option labels',()=>{
 const body=p('Subject-Specific Questions')+p('26. Compare compounds (A) and (B). Which conversion is correct?')+p('A) Compound (A) converts to (B)')+p('B) beta')+p('C) gamma')+p('D) delta')+p('Answer Key')+p('26 A');const q=inspect(doc(body)).questions[0];assert.equal(q.answer,'A');assert.deepEqual(q.answer_diagnostics.option_counts,{A:1,B:1,C:1,D:1});
});
test('matching-column labels belong to the stem, separate numbered pairings are the options',()=>{
 let body=p('Subject-Specific Questions')+p('26. Match the following');for(let n=1;n<=4;n++)body+=p(String(n))+p(['A','B','C','D'][n-1]+') column description '+n);for(const a of ['A','B','C','D'])body+=p(a+') 1 - c; 2 - d; 3 - b; 4 - a');body+=p('Answer Key')+p('26 B');const q=inspect(doc(body)).questions[0];assert.equal(q.answer,'B');assert.ok(q.answer_diagnostics.question_text.includes('column description'));assert.equal(q.answer_diagnostics.options.length,4);
});
test('answer remarks report real key and bold evidence without hiding genuine duplicate labels',()=>{
 const {validateTemplate}=require('./submission-policy');const b=doc(p('Subject-Specific Questions')+p('26. Which result?')+p('A) alpha')+'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>B) beta</w:t></w:r></w:p>'+p('C) gamma')+p('D) delta')+p('Answer Key')+p('26 A'));const info=inspectForDepartment(b,{common_rm_id:201}),e=validateTemplate(b,{common_rm_id:201},info).answer_errors[0];assert.equal(e.question,26);assert.equal(e.question_text,'26. Which result?');assert.deepEqual(e.key_answers,['A']);assert.deepEqual(e.bold_options,['B']);assert.match(e.remark,/key question 26 says A; option B/);
 const duplicate=inspect(doc(p('Subject-Specific Questions')+p('26. Which result?')+p('A) alpha')+p('A) another alpha')+p('B) beta')+p('C) gamma')+p('D) delta')+p('Answer Key')+p('26 A'))).questions[0];assert.equal(duplicate.answer,null);assert.match(duplicate.answer_error,/A \(2 occurrences\)/);
});
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
test('adjacent bare option labels with equations retain all four labels and bold the selected formula',()=>{
 let body=p('Subject-Specific Questions')+p('26. Which expression applies?');
 for(const label of ['a','b','c','d'])body+=`<w:p><w:r><w:t>(${label}) </w:t></w:r><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x${label}=2</m:t></m:r></m:oMath></w:p>`;
 body+=p('Answer Key')+'<w:tbl>'+row([26,'B'])+'</w:tbl>';
 const q=inspect(doc(body)).questions[0];assert.equal(q.answer,'B');assert.deepEqual(layout(q.xml).options.map(o=>o.label),['A','B','C','D']);
 const xml=markedQuestion(q.xml,q.answer,q.number),l=layout(xml);assert.ok(l.text.includes('xb=2'));assert.ok(xml.includes('m:val="b"'));
 const selected=l.runs.find(r=>r.text==='xb=2');assert.equal(selected.node.getElementsByTagName('w:b')[0].getAttribute('w:val'),'1');
 assert.equal(l.doc.getElementsByTagName('w:keepNext').length,4);assert.equal(l.doc.getElementsByTagName('w:keepLines').length,5);
});
