const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {PersistentData,portableName,open,close,all,run}=require('./persistent-data');
const {createCloudStorage}=require('./cloud_storage');
const key='database/papers.db';
function memoryCloud(){
 const objects=new Map();let serial=0;
 return {enabled:true,objects,fail:false,
  async metadata(k){return objects.has(k)?{generation:objects.get(k).generation}:null;},
  async download(k,g){const o=objects.get(k);assert.equal(o.generation,String(g));return o.buffer;},
  async upload(f,k,{generation=0}={}){
   if(this.fail)throw Object.assign(Error('No permission'),{code:403});
   if(String(objects.get(k)?.generation||0)!==String(generation))throw Object.assign(Error('Conflict'),{code:412});
   const g=String(++serial);objects.set(k,{generation:g,buffer:fs.readFileSync(f)});return g;
  },
  async putDocument(f,k){if(!objects.has(k))await this.upload(f,k);}
 };
}
async function schema(db){
 await run(db,'CREATE TABLE IF NOT EXISTS papers(id TEXT PRIMARY KEY,path TEXT,label TEXT)');
 await run(db,'CREATE TABLE IF NOT EXISTS templates(set_name TEXT PRIMARY KEY,path TEXT)');
 await run(db,'CREATE TABLE IF NOT EXISTS generations(id TEXT PRIMARY KEY,path TEXT)');
 await run(db,'CREATE TABLE IF NOT EXISTS screenings(paper_id TEXT PRIMARY KEY,report TEXT)');
}
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qp-storage-test-')),seed=path.join(dir,'seed');
 fs.mkdirSync(path.join(seed,'files'),{recursive:true});const db=await open(path.join(seed,'papers.db'));await schema(db);
 await run(db,'INSERT INTO papers VALUES (?,?,?)',['past','D:\\old-computer\\data\\files\\past.docx','original']);
 fs.writeFileSync(path.join(seed,'files','past.docx'),'word-fixture');await close(db);
 const cloud=memoryCloud(),instances=[];
 async function instance(name){const p=new PersistentData({data:path.join(dir,name),seed,cloud});instances.push(p);await p.initialize();await schema(p.db);return p;}
 t.after(async()=>{for(const p of instances)await p.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {cloud,instance,seed};
}
test('Windows document paths are portable on the Linux host',()=>{
 assert.equal(portableName('D:\\papers\\files\\a.docx'),'a.docx');assert.equal(portableName('/app/data/files/a.docx'),'a.docx');
});
test('first startup persists seed files and rows; a fresh container restores them',async t=>{
 const {cloud,instance}=await setup(t);const a=await instance('first');await a.recoverSeed();
 assert.ok(cloud.objects.has('files/past.docx'));assert.ok(cloud.objects.has(key));
 await a.use(async()=>{await run(a.db,'INSERT INTO papers VALUES (?,?,?)',['new','new.docx','uploaded']);await a.commit();});
 const b=await instance('restart');assert.equal((await all(b.db,'SELECT * FROM papers')).length,2);
});
test('an empty remote database recovers the archive and keeps a backup',async t=>{
 const {cloud,instance}=await setup(t);const a=await instance('first');
 await run(a.db,'DELETE FROM papers');await a.commit();
 const b=await instance('repair');const result=await b.recoverSeed();
 assert.equal(result.recovered,1);assert.equal((await all(b.db,'SELECT * FROM papers')).length,1);
 assert.ok([...cloud.objects.keys()].some(k=>k.startsWith('recovery/')));
});
test('recovery keeps newer cloud values and repeats without duplicates',async t=>{
 const {instance}=await setup(t);const a=await instance('first');await a.recoverSeed();
 await a.use(async()=>{await run(a.db,"UPDATE papers SET label='cloud correction'");await a.commit();});
 const b=await instance('restart');assert.equal((await b.recoverSeed()).recovered,0);
 assert.equal((await all(b.db,'SELECT label FROM papers'))[0].label,'cloud correction');
});
test('cloud write failure is reported and unsaved changes are discarded on next read',async t=>{
 const {cloud,instance}=await setup(t);const a=await instance('first');await a.recoverSeed();cloud.fail=true;
 await assert.rejects(a.use(async()=>{await run(a.db,"UPDATE papers SET label='unsaved'");await a.commit();}),e=>e.status===503);
 cloud.fail=false;await a.use(async()=>assert.equal((await all(a.db,'SELECT label FROM papers'))[0].label,'original'));
});
test('overlapping revisions cannot overwrite the other instance saved record',async t=>{
 const {instance}=await setup(t);const a=await instance('first');await a.recoverSeed();const b=await instance('second');
 await run(b.db,"UPDATE papers SET label='stale'");
 await a.use(async()=>{await run(a.db,"UPDATE papers SET label='winner'");await a.commit();});
 await assert.rejects(b.commit(),e=>e.status===409);
 await b.use(async()=>assert.equal((await all(b.db,'SELECT label FROM papers'))[0].label,'winner'));
});
test('requests on one instance are serialized until saving finishes',async t=>{
 const {instance}=await setup(t);const a=await instance('first');await a.recoverSeed();let release;const gate=new Promise(r=>release=r),order=[];
 const first=a.use(async()=>{order.push('start');await gate;await a.commit();order.push('saved');});
 const second=a.use(async()=>order.push('read'));await new Promise(r=>setImmediate(r));assert.deepEqual(order,['start']);
 release();await Promise.all([first,second]);assert.deepEqual(order,['start','saved','read']);
});
test('recovery refuses to publish a record whose Word document is missing',async t=>{
 const {cloud,instance,seed}=await setup(t);fs.unlinkSync(path.join(seed,'files','past.docx'));const a=await instance('first');
 await assert.rejects(a.recoverSeed(),/Cannot recover/);assert.equal(cloud.objects.has(key),false);
});
test('cloud credentials or permissions failures cannot fall back to temporary storage',async()=>{
 const configured=createCloudStorage({env:{K_SERVICE:'portal'}});await assert.rejects(configured.metadata(key),/GCS_BUCKET_NAME/);
 const cloud=createCloudStorage({bucket:{file(){return {async getMetadata(){throw Object.assign(Error('Forbidden'),{code:403});}};}}});
 await assert.rejects(cloud.metadata(key),/Forbidden/);
});
test('document upload is awaited and generation precondition is passed to GCS',async t=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'qp-object-test-')),'a.docx');fs.writeFileSync(file,'fixture');
 t.after(()=>fs.rmSync(path.dirname(file),{recursive:true,force:true}));let resolve,seen;
 const cloud=createCloudStorage({bucket:{async upload(f,options){seen=options;await new Promise(r=>resolve=r);return [{metadata:{generation:'7'}},{}];}}});
 let complete=false;const pending=cloud.putDocument(file,'files/a.docx').then(()=>complete=true);
 await new Promise(r=>setImmediate(r));assert.equal(complete,false);assert.equal(seen.preconditionOpts.ifGenerationMatch,0);
 resolve();await pending;assert.equal(complete,true);
});
