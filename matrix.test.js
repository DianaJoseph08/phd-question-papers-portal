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
