const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {DepartmentRegistry,misplacedClinicalPsychology,misplacedClinicalGeneration}=require('./departments');
const {open,close,all,run}=require('./persistent-data');
const {scope,canSubmit,canViewPaper}=require('./access');
async function setup(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qp-department-test-')),db=await open(path.join(directory,'test.db'));
 t.after(async()=>{await close(db);assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 const base=[{id:105,name:'CLINICAL PSYCOLOGY',institution_id:5,institution:'College of Engineering and Technology',campus_id:2,campus:'Trichy'},
  {id:45,name:'Clinical Psychology',institution_id:7,institution:'College of Allied Health Sciences',campus_id:2,campus:'Trichy'}];
 const hods=[{id:53,department_id:45,campus_id:2,role:'hod',name:'FMHS Clinical HoD'},{id:74,department_id:105,campus_id:2,role:'hod',name:'Old engineering account'}];
 const registry=new DepartmentRegistry({db:()=>db,base,hods,institutions:[{id:5,name:'College of Engineering and Technology',campus_id:2,campus:'Trichy'},{id:7,name:'College of Allied Health Sciences',campus_id:2,campus:'Trichy'}]});
 return {registry,db,base,hods};
}
test('Clinical Psychology spelling variants are excluded from Engineering only',()=>{
 for(const name of ['CLINICAL PSYCOLOGY','Clinical Psychology','  Clinical  Psycology '])assert.equal(misplacedClinicalPsychology({name,institution:'College of Engineering and Technology'}),true);
 assert.equal(misplacedClinicalPsychology({name:'Clinical Psychology',institution:'Faculty of Medical and Health Sciences'}),false);
 assert.equal(misplacedClinicalPsychology({name:'Psychology',institution:'College of Engineering and Technology'}),false);
 assert.equal(misplacedClinicalGeneration({department_name:'CLINICAL PSYCOLOGY',department_key:'clinical psycology|engineering'}),true);
 assert.equal(misplacedClinicalGeneration({department_name:'Clinical Psychology',department_key:'clinical psychology|health'}),false);
});
test('FMHS Clinical Psychology retains its HoD, Common RM and subject-only upload assignment',async t=>{
 const {registry,hods}=await setup(t),departments=await registry.load();
 assert.deepEqual(departments.map(d=>d.id),[45]);assert.equal(departments[0].hod_name,'FMHS Clinical HoD');assert.equal(departments[0].common_rm_id,-204);assert.equal(departments[0].submission_format,'25 subject');
 assert.equal(canSubmit(hods[0],departments[0]),true);assert.equal(scope(hods[1],departments[0]),false);
 assert.equal(canViewPaper({role:'admin'},undefined),false);
});
test('existing custom engineering duplicates are hidden without deleting their records or historical files',async t=>{
 const {registry,db,base}=await setup(t);await registry.load();
 await run(db,"INSERT INTO custom_departments (id,name,institution_id,hod_user_id,created_by) VALUES (1000,'Clinical Psychology',5,74,1)");
 const before=JSON.stringify(base),departments=await registry.load();assert.deepEqual(departments.map(d=>d.id),[45]);
 assert.equal((await all(db,'SELECT * FROM custom_departments')).length,1);assert.equal(JSON.stringify(base),before);
 const cardiac=await registry.create({name:'Cardiac Care Technology',institution_id:7,hod_user_id:53},1);
 assert.equal(cardiac.id,1001,'A hidden saved department ID cannot be reused');
});
test('administrators cannot recreate Clinical Psychology under Engineering',async t=>{
 const {registry}=await setup(t);
 await assert.rejects(registry.create({name:'Clinical Psychology',institution_id:5,hod_user_id:74},1),/belongs under FMHS/);
 await assert.rejects(registry.create({name:'CLINICAL PSYCOLOGY',institution_id:5},1),/belongs under FMHS/);
 await assert.rejects(registry.create({name:'Clinical Psychology',institution_id:7},1),e=>e.status===409);
});
test('unrelated Trichy health departments remain available with FMHS Common RM and an assigned HoD',async t=>{
 const {registry}=await setup(t);
 const cardiac=await registry.create({name:'Cardiac Care Technology',institution_id:7,hod_user_id:53},1);
 assert.equal(cardiac.common_rm_id,-204);assert.equal(canSubmit({id:53,role:'hod',campus_id:2,department_id:45},cardiac),true);
 assert.equal(canSubmit({id:74,role:'hod',campus_id:2,department_id:105},cardiac),false);
});
