const {test}=require('node:test'),assert=require('node:assert/strict');
const {screen,similarity}=require('./screening');
const {choose}=require('./papers');
const q=i=>({text:`What is the objective of research technique ${i}? A) One B) Two C) Three D) Four`});
test('10 matches accepted and 11 rejected, each new question counted once',()=>{const archive={session:'January 2026',set_name:'A',campus:'Ramapuram',questions:Array.from({length:20},(_,i)=>q(i))};for(const count of [10,11]){const result=screen(Array.from({length:count},(_,i)=>q(i)),[archive,{...archive,set_name:'B'}],'A');assert.equal(result.matched_count,count);assert.equal(result.rejected,count>10);assert.equal(result.matches.length,count*2);assert.equal(result.matches[0].past_question,1);}});
test('reordered options and changed question numbering do not hide identical stem',()=>assert.equal(similarity('1. What is entropy? A) X B) Y C) Z D) W','9. What is entropy? A) W B) Z C) X D) Y').score,1));
test('accepted Word option punctuation and Q prefixes do not hide identical stems',()=>{
 for(const label of ['A:','A-','A.','(A)'])assert.equal(similarity('Q1. What is entropy? '+label+' X B: Y','Question 9. What is entropy? A) Z B) W').score,1);
});
test('original numbers and section references do not undercount matching uploaded blocks',()=>{
 const questions=['research','subject'].flatMap(section=>Array.from({length:6},(_,i)=>({...q(i),number:i+1,section})));
 const result=screen(questions,[{questions:[{...q(0),number:26,section:'subject'},...Array.from({length:5},(_,i)=>q(i+1))]}],'B');
 assert.equal(result.matched_count,12);assert.equal(result.rejected,true);assert.equal(result.matches[0].past_question,26);assert.ok(result.matches.some(m=>m.upcoming_question===1&&m.upcoming_section==='subject'));
});
test('likely paraphrase detected using equivalent wording and word order',()=>assert.ok(similarity('What is the purpose of random selection of research participants? A) X','What objective does choosing research subjects at random serve? A) X').score>=0.8));
test('different numerical values and negation are not equated',()=>{assert.equal(similarity(q(1).text,q(2).text).score,0);assert.equal(similarity('Which research technique is reliable?','Which research technique is not reliable?').score,0);});
test('unrelated stems are not matched just because options match',()=>assert.equal(screen([{text:'What governs electromagnetic wave propagation? A) X B) Y C) Z D) W'}],[{questions:[{text:'Which enzyme catalyzes glucose metabolism? A) X B) Y C) Z D) W'}]}],'A').matched_count,0));
test('single campus uses both sets and generates complementary final papers',()=>{const pools=['A','B'].map(set_name=>({campus:2,set_name,questions:['research','subject'].flatMap(section=>Array.from({length:25},(_,i)=>({section,hash:set_name+section+i})))}));const first=choose(pools,true,'A');assert.equal(first.length,50);assert.equal(first.filter(q=>q.source.set_name==='A').length,25);assert.ok(first.every(q=>q.source.campus===2));const used=new Set(first.map(q=>q.hash));const second=choose(pools.map(p=>({...p,questions:p.questions.filter(q=>!used.has(q.hash))})),true,'B');assert.equal(second.length,50);assert.equal(new Set([...first,...second].map(q=>q.hash)).size,100);});
test('two campuses contribute equally from both sets',()=>{const pools=[1,2].flatMap(campus=>['A','B'].map(set_name=>({campus,set_name,questions:['research','subject'].flatMap(section=>Array.from({length:25},(_,i)=>({section,hash:campus+set_name+section+i})))})));const result=choose(pools,false);assert.equal(result.length,50);assert.equal(result.filter(q=>q.source.campus===1).length,25);for(const p of pools)assert.ok(result.some(q=>q.source===p));});
test('single-campus subjects combine both Common RM campuses without selecting subject questions from the absent campus',()=>{
 const pools=['A','B'].flatMap(set_name=>[{campus:1,department_id:4,set_name,section:'subject'},...[1,2].map(campus=>({campus,department_id:200+campus,set_name,section:'research'}))]).map(p=>({...p,questions:Array.from({length:25},(_,i)=>({section:p.section,hash:p.department_id+p.set_name+i}))}));
 const plan={research:[1,2],subject:[1]},a=choose(pools,true,'A',false,plan),used=new Set(a.map(q=>q.hash)),b=choose(pools.map(p=>({...p,questions:p.questions.filter(q=>!used.has(q.hash))})),true,'B',false,plan);
 for(const [set,qs] of [['A',a],['B',b]]){assert.equal(qs.length,50);assert.equal(qs.filter(q=>q.section==='research'&&q.source.campus===1).length,set==='A'?13:12);assert.equal(qs.filter(q=>q.section==='subject').length,25);assert.ok(qs.filter(q=>q.section==='subject').every(q=>q.source.campus===1));for(const campus of [1,2])for(const sourceSet of ['A','B'])assert.ok(qs.some(q=>q.section==='research'&&q.source.campus===campus&&q.source.set_name===sourceSet));}
 assert.equal(new Set([...a,...b].map(q=>q.hash)).size,100);
 // Emptying one required campus must fail rather than silently switching back to one campus.
 assert.throws(()=>choose(pools.map(p=>p.campus===2?{...p,questions:[]}:p),true,'A',false,plan),/Insufficient/);
});
test('Trichy-only subject departments still use the shared FET RM campuses and full papers remain equally balanced',()=>{
 const pool=(campus,section,set_name)=>({campus,section,set_name,questions:Array.from({length:25},(_,i)=>({section,hash:campus+section+set_name+i}))});const rm=[1,2].flatMap(c=>['A','B'].map(s=>pool(c,'research',s)));
 for(const set of ['A','B']){const single=choose([...rm,...['A','B'].map(s=>pool(2,'subject',s))],true,set,false,{research:[1,2],subject:[2]});assert.equal(single.filter(q=>q.section==='subject'&&q.source.campus===2).length,25);assert.equal(single.filter(q=>q.section==='research'&&q.source.campus===1).length,set==='A'?13:12);
 const both=choose([...rm,...[1,2].flatMap(c=>['A','B'].map(s=>pool(c,'subject',s)))],false,set,false,{research:[1,2],subject:[1,2]});assert.equal(both.filter(q=>q.source.campus===1).length,25);assert.equal(both.filter(q=>q.source.campus===2).length,25);}
});
