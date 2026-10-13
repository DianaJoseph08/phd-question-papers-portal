const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('fs');
test('matrix renders available-campus cells, unavailable cells and both source sets',()=>{
 const departments=[{id:1,name:'Civil Engineering',institution:'Engineering',campus_id:1},{id:2,name:'Mechanical Engineering',institution:'Engineering',campus_id:1},{id:3,name:'Mechanical Engineering',institution:'Engineering',campus_id:2}];
 const context=vm.createContext({isAdmin:()=>true,state:{departments,papers:[],generations:[]},escape:s=>String(s??'')});vm.runInContext(fs.readFileSync(require.resolve('./public/matrix.js'),'utf8'),context);
 const html=vm.runInContext('matrix()',context);assert.equal((html.match(/class="na"/g)||[]).length,2);assert.equal((html.match(/◷ Pending/g)||[]).length,6);assert.ok(html.includes('RMP Set A')&&html.includes('TRY Set B'));assert.ok(!html.includes('data-generate='));
 context.state.papers=['A','B'].map(set_name=>({id:set_name,department_id:1,set_name,kind:'submission',reviewed:1}));const ready=vm.runInContext('matrix()',context);assert.equal((ready.match(/data-generate="1"/g)||[]).length,2);assert.ok(!ready.includes('data-generate="2"'));
});
test('match report includes both question references and escapes uploaded text',()=>{const context=vm.createContext({escape:s=>String(s??'').replaceAll('<','&lt;')});vm.runInContext(fs.readFileSync(require.resolve('./public/matrix.js'),'utf8'),context);context.report={matched_count:11,limit:10,method:'Local screening',matches:[{upcoming_set:'A',upcoming_question:4,upcoming_text:'<script>unsafe</script>',past_session:'July 2026',past_campus:'Trichy',past_set:'B',past_question:17,past_text:'Past question',type:'Possible rephrasing',similarity:85}]};const html=vm.runInContext('screeningTable(report)',context);assert.ok(html.includes('Question 4')&&html.includes('Question 17')&&html.includes('July 2026'));assert.ok(!html.includes('<script>'));});

test('subject-only matrix waits for approved Common RM without changing subject status',()=>{
 const departments=[{id:1,name:'Civil Engineering',institution:'Engineering',campus_id:1,common_rm_id:201},{id:201,name:'Common Research Methodology (FET)',institution:'Engineering',campus_id:1,is_common:true,faculty_code:'FET'}];
 const papers=['A','B'].map(set_name=>({id:set_name,department_id:1,set_name,kind:'submission',reviewed:1,counts:'{"research":0,"subject":25}'}));
 const context=vm.createContext({isAdmin:()=>true,state:{departments,papers,generations:[]},escape:s=>String(s??'')});vm.runInContext(fs.readFileSync(require.resolve('./public/matrix.js'),'utf8'),context);
 const waiting=vm.runInContext('matrix()',context);assert.ok(waiting.includes('Awaiting approved Common RM'));assert.ok(!waiting.includes('data-generate="1"'));
 context.state.papers.push(...['A','B'].map(set_name=>({id:'common-'+set_name,department_id:201,set_name,kind:'submission',reviewed:1,counts:'{"research":25,"subject":0}'})));
 assert.ok(vm.runInContext('matrix()',context).includes('data-generate="1"'));
});
test('structural corrections retain matches and display formatting remarks as advisory',()=>{
 const content={innerHTML:''},dialog={open:false,showModal(){this.open=true;}},context=vm.createContext({escape:s=>String(s??''),$:s=>s==='#previewContent'?content:dialog});
 vm.runInContext(fs.readFileSync(require.resolve('./public/matrix.js'),'utf8'),context);
 context.report={matched_count:1,total_questions:24,limit:10,rejected:false,method:'Local screening',matches:[{upcoming_set:'A',upcoming_question:8,upcoming_section:'subject',upcoming_text:'Uploaded question',past_session:'July 2026',past_campus:'Trichy',past_set:'B',past_question:17,past_text:'Past question',type:'Possible rephrasing',similarity:85}],template:{passed:false,expected:'25 subject',counts:{research:0,subject:24},errors:['Provide 25 subject questions.'],warnings:[],option_errors:[{problem:'missing B'}]}};
 vm.runInContext('showScreening(report,true)',context);assert.ok(dialog.open);assert.ok(content.innerHTML.includes('Question 8')&&content.innerHTML.includes('Question 17')&&content.innerHTML.includes('24 subject'));assert.ok(!content.innerHTML.includes('revise matched'));assert.ok(content.innerHTML.includes('Formatting remarks · advisory')&&content.innerHTML.includes('do not block')&&content.innerHTML.includes('missing B'));assert.ok(content.innerHTML.indexOf('Past question')<content.innerHTML.indexOf('Formatting remarks'));
 context.report.rejected=true;vm.runInContext('showScreening(report,true)',context);assert.ok(content.innerHTML.includes('Too many repeated questions'));assert.ok(content.innerHTML.includes('Template remarks'));
});
test('generation success provides a direct download and identifies automatic Common RM',()=>{
 const content={innerHTML:''},dialog={open:false,showModal(){this.open=true;}},context=vm.createContext({escape:s=>String(s??'').replaceAll('<','&lt;'),$:s=>s==='#previewContent'?content:dialog});
 vm.runInContext(fs.readFileSync(require.resolve('./public/matrix.js'),'utf8'),context);
 context.result={id:'fixture-id',question_count:50,common_rm:[{campus:'Ramapuram',category:'Common RM',coordinator:'Vani <name>'}]};
 vm.runInContext('showGeneratedPaper(result)',context);assert.ok(dialog.open);assert.ok(content.innerHTML.includes('/api/generations/fixture-id/download'));assert.ok(content.innerHTML.includes('Download generated Word paper'));assert.ok(content.innerHTML.includes('included automatically'));assert.ok(content.innerHTML.includes('Vani &lt;name>'));
 assert.ok(content.innerHTML.includes('data-source-record="fixture-id"'));assert.ok(!content.innerHTML.includes('/manifest'));
});
test('answer remarks show the source question, key, bold option and readable evidence safely',()=>{
 const context=vm.createContext({escape:s=>String(s??'').replaceAll('<','&lt;')});vm.runInContext(fs.readFileSync(require.resolve('./public/matrix.js'),'utf8'),context);
 context.report={expected:'25 subject',errors:[],warnings:[],answer_errors:[{question:39,section:'subject',question_text:'Which result <script> applies?',remark:'Key says A; bold option B.',key_question:39,key_answers:['A'],bold_options:['B'],option_counts:{A:1,B:1,C:1,D:1},options:[{label:'B',text:'<beta>'}]}]};
 const html=vm.runInContext('structureSummary(report)',context);assert.ok(html.includes('Question 39'));assert.ok(html.includes('Key question 39: A'));assert.ok(html.includes('Bold answer text: B'));assert.ok(html.includes('Show detected option text'));assert.ok(html.includes('Which result &lt;script>'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Uploading and admin review remain available'));
});
test('saved-paper list keeps every previously generated version and opens its stored file and source record',()=>{
 const generations=[{id:'older-a',department_name:'Civil Engineering',set_name:'A',distribution:'{"Ramapuram":50,"Trichy":0}',created_at:'2026-10-12T10:00:00Z'},{id:'newer-a',department_name:'Civil Engineering',set_name:'A',distribution:'{"Ramapuram":50,"Trichy":0}',created_at:'2026-10-13T10:00:00Z'}];
 const c=vm.createContext({state:{generations},escape:s=>String(s??'')});vm.runInContext(fs.readFileSync(require.resolve('./public/matrix.js'),'utf8'),c);const html=vm.runInContext('generationHistory()',c);
 for(const id of ['older-a','newer-a']){assert.ok(html.includes('/api/generations/'+id+'/download'));assert.ok(html.includes('data-source-record="'+id+'"'));}
 assert.ok(html.includes('2 saved papers'));assert.ok(!html.includes('data-generate='));assert.ok(html.includes('Generated (IST)'));assert.ok(fs.readFileSync(require.resolve('./public/index.html'),'utf8').includes('data-page="generated" class="admin">Generated papers'));
});
test('generated-paper filters retain stored versions and do not invoke generation',()=>{
 const elements=Object.fromEntries(['#generatedSearch','#generatedDepartment','#generatedSet','#generationRows','#generatedCount'].map(s=>[s,{value:'',innerHTML:'',textContent:''}]));
 const generations=[{id:'civil-a-old',department_name:'Civil Engineering',set_name:'A',distribution:'{"Ramapuram":50}',created_at:'2026-10-12T10:00:00Z'},{id:'civil-a-new',department_name:'Civil Engineering',set_name:'A',distribution:'{"Ramapuram":50}',created_at:'2026-10-13T10:00:00Z'},{id:'civil-b',department_name:'Civil Engineering',set_name:'B',distribution:'{"Ramapuram":50}',created_at:'2026-10-13T10:00:00Z'},{id:'math-a',department_name:'Mathematics',set_name:'A',distribution:'{"Ramapuram":25,"Trichy":25}',created_at:'2026-10-13T10:00:00Z'}];
 const c=vm.createContext({state:{generations},escape:s=>String(s??''),$:s=>elements[s],post:()=>{throw Error('Viewing saved papers must not generate again');}});vm.runInContext(fs.readFileSync(require.resolve('./public/matrix.js'),'utf8'),c);vm.runInContext('bindGeneratedPapers()',c);
 elements['#generatedDepartment'].value='Civil Engineering';elements['#generatedSet'].value='A';elements['#generatedSet'].oninput();assert.equal(elements['#generatedCount'].textContent,'Showing 2 of 4 saved papers');for(const id of ['civil-a-old','civil-a-new'])assert.ok(elements['#generationRows'].innerHTML.includes(id));assert.ok(!elements['#generationRows'].innerHTML.includes('civil-b'));
 elements['#generatedSearch'].value='Math';elements['#generatedSearch'].oninput();assert.ok(elements['#generationRows'].innerHTML.includes('No generated papers match'));elements['#generatedDepartment'].value='';elements['#generatedDepartment'].oninput();assert.equal(elements['#generatedCount'].textContent,'Showing 1 of 4 saved papers');assert.equal(generations.length,4);
});
