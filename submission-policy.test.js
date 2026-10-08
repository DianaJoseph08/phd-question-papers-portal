const {test}=require('node:test'),assert=require('node:assert/strict'),Zip=require('pizzip');
const {commonFor,inspectForDepartment,validateTemplate}=require('./submission-policy');
const {choose}=require('./papers');
const linked={id:1,campus_id:1,institution:'Faculty of Engineering and Technology',common_rm_id:201};
function fixture(sections,options='A) alpha B) beta C) gamma D) delta'){
 const z=new Zip(),p=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
 let body='';for(const [heading,count] of sections){body+=p(heading);for(let i=1;i<=count;i++)body+=p(`${i}. Which result follows from experiment ${100+i}? ${options}`);}
 body+=p('Answer Key');z.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);return z.generate({type:'nodebuffer'});
}
test('common RM assignments follow campus and faculty',()=>{
 assert.equal(commonFor(linked),201);assert.equal(commonFor({...linked,campus_id:2}),202);
 assert.equal(commonFor({...linked,campus_id:2,institution:'College of Science and Humanities'}),-203);
 assert.equal(commonFor({...linked,campus_id:2,institution:'College of Occupational Therapy'}),-204);
 assert.equal(commonFor({...linked,institution:'Faculty of Science and Humanities'}),null);
 assert.equal(commonFor({...linked,is_common:true}),null);
});
test('common-RM HoD can upload 25 subject questions or a complete paper',()=>{
 for(const sections of [[['Subject-Specific Questions',25]],[['Research Methodology',25],['Subject-Specific Questions',25]]]){
  const buffer=fixture(sections),info=inspectForDepartment(buffer,linked);assert.equal(info.valid,true);assert.equal(validateTemplate(buffer,linked,info).passed,true);
 }
 const buf=fixture([['Subject-Specific Questions',25]]);assert.equal(inspectForDepartment(buf,{...linked,common_rm_id:null}).valid,false);
});
test('coordinator accepts 25 RM but refuses subject-only papers',()=>{
 const d={is_common:true};assert.equal(inspectForDepartment(fixture([['Research Methodology',25]]),d).valid,true);assert.equal(inspectForDepartment(fixture([['Subject-Specific Questions',25]]),d).valid,false);
});
test('unused RM placeholders do not block valid subject questions',()=>{
 const z=new Zip(fixture([['Subject-Specific Questions',25]]));z.file('word/document.xml',z.file('word/document.xml').asText().replace('<w:body>','<w:body><w:p><w:r><w:t>Research Methodology</w:t></w:r></w:p><w:p><w:r><w:t>1. The question starts here A) Option A B) Option B C) Option C D) Option D</w:t></w:r></w:p>'));
 const buffer=z.generate({type:'nodebuffer'}),info=inspectForDepartment(buffer,linked);assert.equal(info.valid,true);assert.equal(info.questions.length,25);assert.ok(info.warnings.length);
 assert.equal(validateTemplate(buffer,linked,info).passed,true);
});
test('template validation rejects missing options and incorrect question count',()=>{
 const formatting=fixture([['Subject-Specific Questions',25]],'A) one A) two C) three D) four');
 const formattingResult=validateTemplate(formatting,linked,inspectForDepartment(formatting,linked));assert.equal(formattingResult.passed,true);assert.ok(formattingResult.option_errors.length);
 const count=fixture([['Subject-Specific Questions',24]]),countResult=validateTemplate(count,linked,inspectForDepartment(count,linked));assert.equal(countResult.passed,false);assert.ok(countResult.errors.length);
});
test('department heading identifies the assigned subject section',()=>{const buffer=fixture([['Mathematics',25]]);const info=inspectForDepartment(buffer,linked);assert.equal(info.valid,true);assert.equal(info.counts.subject,25);});
test('Mathematics combines three departments with equal campuses and all six sets',()=>{
 const pools=[{department_id:8,campus:1},{department_id:13,campus:1},{department_id:35,campus:2}].flatMap(d=>['A','B'].map(set_name=>({...d,set_name,questions:['research','subject'].flatMap(section=>Array.from({length:25},(_,i)=>({section,hash:d.department_id+set_name+section+i})))})));
 const first=choose(pools,false,'A'),seen=new Set(first.map(q=>q.hash));const second=choose(pools.map(p=>({...p,questions:p.questions.filter(q=>!seen.has(q.hash))})),false,'B');
 for(const questions of [first,second]){assert.equal(questions.length,50);assert.equal(questions.filter(q=>q.source.campus===2).length,25);assert.deepEqual([8,13].map(id=>questions.filter(q=>q.source.department_id===id).length),[13,12]);for(const p of pools)assert.ok(questions.some(q=>q.source.department_id===p.department_id&&q.source.set_name===p.set_name));}
});
test('Common RM source provenance is kept when combined with subject pools',()=>{
 const common={id:'common-source',path:'common.docx',campus:1,department_id:201,set_name:'A'};
 const pools=['A','B'].map(set_name=>({campus:1,department_id:1,set_name,questions:['research','subject'].flatMap(section=>Array.from({length:25},(_,i)=>({section,hash:set_name+section+i,...(section==='research'?{source:{...common,set_name}}:{})})))}));
 const result=choose(pools,true);assert.ok(result.filter(q=>q.section==='research').every(q=>q.source.path==='common.docx'&&q.source.department_id===201));assert.ok(result.filter(q=>q.section==='subject').every(q=>q.source.department_id===1));
});

test('answer keys with set suffixes are excluded and Word line breaks retain option labels',()=>{
 const z=new Zip(fixture([['Subject-Specific Questions',25]]));
 z.file('word/document.xml',z.file('word/document.xml').asText().replaceAll('A) alpha B) beta C) gamma D) delta','A) alpha</w:t><w:br/><w:t>B) beta</w:t><w:br/><w:t>C) gamma</w:t><w:br/><w:t>D) delta').replace('Answer Key','Answer Key AA').replace('</w:body>','<w:tbl><w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>26</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>'));
 const buffer=z.generate({type:'nodebuffer'}),info=inspectForDepartment(buffer,linked);assert.equal(info.questions.length,25);assert.ok(info.questions[0].text.includes('\nB)'));assert.equal(validateTemplate(buffer,linked,info).passed,true);
});

test('Mathematics Section B headings and common option punctuation pass validation',()=>{
 const z=new Zip(),p=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;let body='';
 for(const heading of ['Section A: Research Methodology (25 Questions)','Section B: Mathematics (25 Questions)']){
  body+=p(heading);for(let i=1;i<=25;i++)body+=p(`${i}. Which result follows from experiment ${i}?\n(A) first\nB: second\nC - third\nD. fourth`);
 }
 body+=p('Answer Key');z.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
 const buffer=z.generate({type:'nodebuffer'}),d={id:8,campus_id:1,institution:'Faculty of Engineering and Technology',common_rm_id:201},info=inspectForDepartment(buffer,d),validation=validateTemplate(buffer,d,info);
 assert.deepEqual(info.counts,{research:25,subject:25});assert.equal(validation.passed,true);
});

test('option-formatting issues do not block freshness screening',()=>{
 const z=new Zip(),p=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;let body='';
 for(const heading of ['Research Methodology','Mathematics']){body+=p(heading);for(let i=1;i<=25;i++)body+=p(`${i}. Which result follows from experiment ${i}?\nfirst choice\nsecond choice\nthird choice\nfourth choice`);}
 body+=p('Answer Key');z.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
 const d={id:8,campus_id:1,institution:'Faculty of Engineering and Technology',common_rm_id:201},info=inspectForDepartment(z.generate({type:'nodebuffer'}),d),validation=validateTemplate(z.generate({type:'nodebuffer'}),d,info);
 assert.deepEqual(info.counts,{research:25,subject:25});assert.equal(validation.passed,true);assert.equal(validation.option_errors.length,50);assert.equal(validation.option_errors[0].question,1);assert.equal(validation.option_errors[0].missing,'A, B, C, D');
});
