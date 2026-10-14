const {test}=require('node:test'),assert=require('node:assert/strict');
const {canTrack,coordinatorAssignment}=require('./coordinators');
const {canSubmit,canViewPaper}=require('./access');
const {buildTracker,currentSubmissions}=require('./submission-tracker');
const coordinator=(username,campus_id=username==='infant'?2:1)=>({id:{vani:5,infant:8}[username]||4,username,campus_id,role:'coordinator'});
const departments=[
 {id:1,campus_id:1,campus:'Ramapuram',institution:'Faculty of Engineering and Technology',name:'Civil Engineering',hod_name:'Civil HoD',common_rm_id:201},
 {id:2,campus_id:1,campus:'Ramapuram',institution:'Faculty of Liberal Arts and Business Studies',name:'Mathematics'},
 {id:3,campus_id:1,campus:'Ramapuram',institution:'Faculty of Management',name:'Management'},
 {id:4,campus_id:1,campus:'Ramapuram',institution:'SRM Dental College',name:'Dentistry'},
 {id:201,campus_id:1,campus:'Ramapuram',institution:'Faculty of Engineering and Technology',name:'Common RM',is_common:true,coordinator_id:5,coordinator_name:'Dr. Vani'},
 ...['College of Engineering and Technology','College of Science and Humanities','College of Allied Health Sciences','College of Management Studies','College of Occupational Therapy'].map((institution,i)=>({id:30+i,campus_id:2,campus:'Trichy',institution,name:'Department '+i})),
 {id:1000,is_custom:true,campus_id:2,campus:'Trichy',institution:'College of Engineering and Technology',name:'New department',hod_user_id:99},
];
const paper=(id,set='A',extra={})=>({id,department_id:1,campus_id:1,session:'January 2027',set_name:set,kind:'submission',created_at:'2026-10-14T10:00:00Z',original_name:id+'.docx',uploaded_by:10,counts:'{"research":0,"subject":25}',...extra});
const clean={errors:[],warnings:[],option_errors:[],answer_errors:[],counts:{research:0,subject:25}};
const screen={matched_count:0,submission_note:''};
function tracker(papers,extra={}){return buildTracker({user:coordinator('vani'),departments,users:[{id:10,name:'Civil HoD',password:'private'}],papers,
 screenings:new Map(papers.map(p=>[p.id,screen])),checks:new Map(papers.map(p=>[p.id,{template:clean}])),...extra});}
test('five coordinators track only their assigned campus and faculty, including the S&H admissions alias',()=>{
 for(const [name,expected] of [['vani',[1,201]],['sutha',[2]],['priya',[3]],['deepika',[4]],['infant',[30,31,32,33,34,1000]]])assert.deepEqual(departments.filter(d=>canTrack(coordinator(name),d)).map(d=>d.id),expected);
 assert.ok(canTrack(coordinator('sutha'),{campus_id:1,institution:'Faculty of Science and Humanities'}));
 assert.equal(coordinatorAssignment(coordinator('VANI')).faculty,'engineering');
 assert.equal(coordinatorAssignment(coordinator('vani',2)),null);
 assert.equal(coordinatorAssignment({...coordinator('sutha'),role:'hod'}),null);
 assert.equal(coordinatorAssignment(coordinator('other-coordinator')),null);
});
test('tracking access grants read-only department access while common RM submission assignments remain unchanged',()=>{
 for(const name of ['vani','sutha','priya','deepika','infant'])for(const d of departments)if(canTrack(coordinator(name),d)){
  assert.ok(canViewPaper(coordinator(name),d));
  assert.equal(canSubmit(coordinator(name),d),name==='vani'&&d.id===201);
 }
 assert.equal(canViewPaper(coordinator('sutha'),departments[0]),false);
});
test('missing sets and both submitted sets are counted separately from approval and Common RM',()=>{
 const data=tracker([paper('a'),paper('b','B')]);
 assert.deepEqual(data.summary,{departments:1,completed:1,pending:0,needs_attention:0,pending_sets:0,common_categories:1,common_completed:0});
 assert.equal(data.departments.find(d=>d.department_id===1).approved,false);
 assert.equal(data.departments.find(d=>d.department_id===201).completed,false);
 assert.ok(!JSON.stringify(data).includes('private'));
 const partial=tracker([paper('a')]);assert.equal(partial.summary.pending,1);assert.equal(partial.summary.pending_sets,1);
});
test('current template checks override stale saved remarks and a corrected reupload clears old errors',()=>{
 const old=paper('old','A',{created_at:'2026-10-13'}),fresh=paper('fresh');
 const data=tracker([fresh,old],{screenings:new Map([['fresh',{...screen,template:{answer_errors:[{remark:'obsolete'}]}}]]),checks:new Map([['fresh',{template:clean}],['old',{template:{...clean,errors:['Old count error']}}]])});
 const set=data.departments.find(d=>d.department_id===1).sets[0];assert.equal(set.id,'fresh');assert.deepEqual(set.remarks,[]);assert.equal(set.needs_attention,false);
});
test('approved submissions can still have outstanding count, option and answer remarks',()=>{
 const p=paper('a','A',{reviewed:1});const data=tracker([p],{checks:new Map([['a',{template:{...clean,errors:['Need 25 subject questions'],option_errors:[{question:6,section:'subject',missing:'D'}],answer_errors:[{question:7,section:'subject',remark:'Key B differs from bold C'}]}}]])});
 const set=data.departments.find(d=>d.department_id===1).sets[0];assert.equal(set.status,'approved');assert.equal(set.needs_attention,true);assert.equal(set.remarks.length,3);assert.equal(set.remarks[2].question,7);assert.equal(data.summary.needs_attention,1);
});
test('a removed current set does not resurrect an older version even when timestamps tie',()=>{
 assert.deepEqual(currentSubmissions([paper('removed','A',{deleted_at:'2026-10-14'}),paper('older')] ),[]);
 assert.equal(tracker([paper('removed','A',{deleted_at:'2026-10-14'}),paper('older')]).summary.pending_sets,2);
});
test('missing screening or an unreadable Word document is never reported as clean',()=>{
 const data=tracker([paper('a')],{screenings:new Map(),checks:new Map([['a',{error:'Original document unavailable'}]])});
 const set=data.departments.find(d=>d.department_id===1).sets[0];assert.equal(set.checks_available,false);assert.equal(set.needs_attention,true);assert.equal(set.remarks.length,2);
});
test('notes and within-limit matches are visible without being described as unresolved errors',()=>{
 const data=tracker([paper('a')],{screenings:new Map([['a',{matched_count:10,submission_note:'Please check the diagram',warning:'Some archives were incomplete'}]])});
 const set=data.departments.find(d=>d.department_id===1).sets[0];assert.equal(set.matched_count,10);assert.equal(set.remarks.length,3);assert.equal(set.needs_attention,false);
});
test('a rejected attempt is shown until a later accepted upload replaces it',()=>{
 const attempts=[{actor_name:'Civil HoD',created_at:'2026-10-14T11:00:00Z',details:JSON.stringify({department_id:'1',session:'January 2027',set:'A',filename:'rejected.docx',reason:'11 matching questions'})}];
 assert.ok(tracker([paper('a')],{attempts}).departments.find(d=>d.department_id===1).sets[0].latest_attempt);
 assert.equal(tracker([paper('fixed','A',{created_at:'2026-10-14T12:00:00Z'})],{attempts}).departments.find(d=>d.department_id===1).sets[0].latest_attempt,null);
 assert.equal(tracker([paper('removed-fixed','A',{created_at:'2026-10-14T12:00:00Z',deleted_at:'2026-10-14T13:00:00Z'})],{attempts}).departments.find(d=>d.department_id===1).sets[0].latest_attempt,null,'Removal must not resurrect an obsolete rejection remark');
});
test('tracker data cannot leak another faculty, campus, past sessions or generated papers',()=>{
 const data=buildTracker({user:coordinator('sutha'),departments,papers:[paper('private-engineering'),paper('archive','A',{kind:'archive',session:'January 2026'}),paper('trichy','A',{department_id:30,campus_id:2})]});
 assert.deepEqual(data.departments.map(d=>d.department_id),[2]);assert.ok(!JSON.stringify(data).includes('private-engineering'));assert.ok(!JSON.stringify(data).includes('archive.docx'));
 assert.deepEqual(buildTracker({user:{role:'hod'},departments}).departments,[]);
});
