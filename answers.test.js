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

function matchingPaper({codes=true,table=true,automatic=false,roman=false,stem='Match the following protocols with their properties.'}={}){
 const data=[];for(let i=1;i<=4;i++)data.push([roman?numbered('Protocol '+i,10,0):p('ABCD'[i-1]+'. Protocol '+i),automatic?numbered('Property '+i,9,0):p(i+'. Property '+i)]);
 const columns=[p('List-I (Protocol)'),p('List-II (Property)')];
 const columnsBody=table?'<w:tbl>'+[columns,...data].map(cells=>'<w:tr>'+cells.map(xml=>'<w:tc>'+xml+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>':[...columns,...data.flat()].join('');
 let body=p('Research Methodology')+p('1. '+stem)+columnsBody+(codes?p('Codes:'):'');
 const choices=roman?['I-1, II-2, III-3, IV-4','I-2, II-1, III-4, IV-3','I-3, II-4, III-1, IV-2','I-4, II-3, III-2, IV-1']:['A-3, B-2, C-1, D-4','A-1, B-3, C-4, D-2','A-3, B-1, C-2, D-4','A-4, B-1, C-3, D-2'];for(let i=0;i<4;i++)body+=p('('+'ABCD'[i]+') '+choices[i]);
 for(let i=2;i<=25;i++)body+=question(i);
 body+=p('Subject-Specific Questions');for(let i=26;i<=50;i++)body+=question(i);body+=p('Answer Key');for(let i=1;i<=50;i++)body+=p(i+' '+(i===1?'C':'B'));
 return automatic||roman?numberedDoc(body,(automatic?list(9,level(0,'decimal')):'')+(roman?list(10,level(0,'upperRoman')):'')):doc(body);
}
test('numbered matching-table entries stay in question 1 and all 50 answers use the visible question number',()=>{
 for(const options of [{},{table:false},{codes:false},{automatic:true}]){
  const info=inspect(matchingPaper(options));assert.deepEqual(info.counts,{research:25,subject:25});assert.deepEqual(info.questions.map(q=>q.source_number),Array.from({length:50},(_,i)=>i+1));assert.ok(info.questions.every(q=>q.answer_key_number===q.source_number&&!q.answer_error));assert.equal(info.questions[0].answer,'C');assert.ok(info.questions[0].answer_diagnostics.question_text.includes('4. Property 4')||options.automatic);
 }
});
test('Match List I/List II variants preserve Roman labels without counting their numbered table entries as questions',()=>{
 for(const stem of ['Match the LIST-I with LIST-II','Match List I with List II','Match the following']){
  const info=inspect(matchingPaper({roman:true,codes:false,stem}));assert.deepEqual(info.counts,{research:25,subject:25});assert.ok(info.questions.every(q=>q.answer&&!q.answer_error&&q.answer_key_number===q.source_number));for(const numeral of ['I','II','III','IV'])assert.ok(info.questions[0].text.includes(numeral+'. Protocol'));assert.equal(layout(info.questions[0].xml).separateChoices,true);
 }
});
test('shuffled Roman matching questions at final position four do not absorb the following question five',t=>{
 const fs=require('fs'),os=require('os'),path=require('path'),{generate}=require('./papers'),{examCopy}=require('./exam-copy'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'qp-roman-matching-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 const buffer=matchingPaper({roman:true,codes:false,stem:'Match List I with List II'}),file=path.join(dir,'source.docx');fs.writeFileSync(file,buffer);const qs=inspect(buffer).questions,selected=[...qs.slice(1,4),qs[0],...qs.slice(4)].map(q=>({...q,source:{path:file}})),output=generate(selected,'Commerce','B',require('./test-template').templateFixture('B')),info=inspect(output);assert.deepEqual(info.counts,{research:25,subject:25});assert.equal(info.questions[3].answer,'C');assert.equal(info.questions[4].source_number,5);assert.ok(info.questions[3].text.includes('IV. Protocol 4'));assert.ok(info.questions.every(q=>q.answer&&!q.answer_error));assert.deepEqual(inspect(examCopy(output)).counts,{research:25,subject:25});
});
test('two genuine pairing-choice lists remain flagged as duplicate answer labels',()=>{
 let body=p('Subject-Specific Questions')+p('35. Match List I with List II');for(let block=0;block<2;block++)for(const label of ['A','B','C','D'])body+=p(label+') I-1, II-2, III-3, IV-4');body+=p('Answer Key')+p('35 C');const q=inspect(doc(body)).questions[0];assert.equal(q.answer,null);assert.match(q.answer_error,/2 occurrences/);
});
test('an incomplete matching choice list never consumes the real questions following its table',()=>{
 const z=new Zip(matchingPaper({codes:false}));z.file('word/document.xml',z.file('word/document.xml').asText().replace('(D) A-4, B-1, C-3, D-2','Unlabelled fourth answer'));
 const info=inspect(z.generate({type:'nodebuffer'}));assert.deepEqual(info.counts,{research:25,subject:25});assert.ok(info.questions[0].answer_error);assert.equal(info.questions[1].source_number,2);assert.equal(info.questions[1].answer_key_number,2);assert.equal(info.questions[1].answer,'B');
});
test('matching and statement-combination questions remain readable after template generation and exam-copy conversion',t=>{
 const fs=require('fs'),os=require('os'),path=require('path'),{generate}=require('./papers'),{examCopy}=require('./exam-copy');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qp-matching-'));t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 const buffer=matchingPaper(),file=path.join(directory,'matching-source.docx');fs.writeFileSync(file,buffer);const source=inspect(buffer).questions.map(q=>({...q,source:{path:file}}));
 const output=generate(source,'Computer Science','B',require('./test-template').templateFixture('B')),parsed=inspect(output);assert.deepEqual(parsed.counts,{research:25,subject:25});assert.equal(parsed.questions[0].answer,'C');assert.ok(parsed.questions.every(q=>q.answer&&!q.answer_error));assert.ok(parsed.questions[0].answer_diagnostics.question_text.includes('4. Property 4'));
 const exam=inspect(examCopy(output));assert.deepEqual(exam.counts,{research:25,subject:25});assert.ok(exam.questions.every(q=>q.answer===null));assert.deepEqual(fs.readFileSync(file),buffer);
});
test('explicit answer instructions separate labelled statements from choices, including references inside choice text',()=>{
 for(const label of [a=>a+'. ',a=>'('+a+') ']){
  const statements='ABCDE'.split('').map(a=>p(label(a)+'Statement '+a)).join(''),options=['(A) and (B) Only','(A), (B) and (C) Only','(A), (B) and (D) Only','(B) and (D) Only'];
  const q=inspect(doc(p('Research Methodology')+p('7. Which statements apply?')+statements+p('Choose the correct answer from the options given below :')+options.map((v,i)=>p('('+'ABCD'[i]+') '+v)).join('')+p('Answer Key')+p('7 D'))).questions[0];
  assert.equal(q.answer,'D');assert.equal(q.answer_key_number,7);assert.equal(q.answer_error,null);assert.deepEqual(q.answer_diagnostics.option_counts,{A:1,B:1,C:1,D:1});assert.ok(q.answer_diagnostics.question_text.includes('Statement E'));assert.equal(q.answer_diagnostics.options[3].text,'(B) and (D) Only');
 }
});
test('combination choices without an instruction line preserve the preceding statements as stem content',()=>{
 const q=inspect(doc(p('Research Methodology')+p('23. Which combination applies?')+['A','B','C','D'].map(a=>p(a+'. Statement '+a)).join('')+['A, B and C','B, C and D','A, C and D','A, B and D'].map((v,i)=>p('('+'ABCD'[i]+') '+v)).join('')+p('Answer Key')+p('23 B'))).questions[0];
 assert.equal(q.answer,'B');assert.equal(q.answer_error,null);assert.ok(q.answer_diagnostics.question_text.includes('Statement D'));assert.equal(q.answer_diagnostics.options.length,4);
});
test('a duplicate label in the actual answer block is still reported and never silently discarded',()=>{
 const before=p('Research Methodology')+p('5. Which statement applies?')+['A','B','C','D'].map(a=>p(a+'. Statement '+a)).join('')+p('Choose the correct answer from the options given below:');
 const q=inspect(doc(before+p('(A) first choice')+p('(A) another first choice')+p('(B) second choice')+p('(C) third choice')+p('(D) fourth choice')+p('Answer Key')+p('5 B'))).questions[0];assert.equal(q.answer,null);assert.match(q.answer_error,/A \(2 occurrences\)/);assert.deepEqual(q.answer_diagnostics.option_counts,{A:2,B:1,C:1,D:1});
});
