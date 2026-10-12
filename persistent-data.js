const fs=require('fs'),path=require('path'),crypto=require('crypto'),sqlite=require('sqlite3');
const all=(db,sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,r)=>e?reject(e):resolve(r)));
const run=(db,sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this)}));
const open=(file,flags=sqlite.OPEN_READWRITE|sqlite.OPEN_CREATE)=>new Promise((resolve,reject)=>{const db=new sqlite.Database(file,flags,e=>e?reject(e):resolve(db));});
const close=db=>db?new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve())):Promise.resolve();
const portableName=file=>path.posix.basename(String(file).replace(/\\/g,'/'));
const key='database/papers.db';

async function checkDatabase(file){
 const db=await open(file,sqlite.OPEN_READONLY);
 try{const rows=await all(db,'PRAGMA quick_check');if(rows.length!==1||rows[0].quick_check!=='ok')throw Error('The stored database failed its integrity check.');}
 finally{await close(db);}
}

class PersistentData{
 constructor({data,seed,cloud}){
  this.data=data;this.seed=seed;this.cloud=cloud;this.file=path.join(data,'papers.db');
  this.db=null;this.generation='0';this.queue=Promise.resolve();this.reload=false;
 }
 async initialize(){
  fs.mkdirSync(path.join(this.data,'files'),{recursive:true});
  if(this.cloud.enabled){
   const m=await this.cloud.metadata(key);
   if(m)await this.replace(await this.cloud.download(key,m.generation),String(m.generation));
   else if(fs.existsSync(path.join(this.seed,'papers.db'))&&path.resolve(this.seed)!==path.resolve(this.data)){
    fs.copyFileSync(path.join(this.seed,'papers.db'),this.file);
   }
  }
  if(!this.db)this.db=await open(this.file);
 }
 async replace(buffer,generation){
  const temp=this.file+'.restore-'+crypto.randomUUID();
  try{
   fs.writeFileSync(temp,buffer);await checkDatabase(temp);
   // Close SQLite before replacing the file, including its cached pages.
   await close(this.db);this.db=null;
   fs.renameSync(temp,this.file);this.db=await open(this.file);
   this.generation=generation;this.reload=false;
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 }
 async refresh(){
  if(!this.cloud.enabled)return;
  const m=await this.cloud.metadata(key);
  if(!m){if(this.generation!=='0')throw Error('The cloud database is missing. Uploads are paused to protect existing data.');return;}
  if(this.reload||String(m.generation)!==this.generation)await this.replace(await this.cloud.download(key,m.generation),String(m.generation));
 }
 async use(action){
  const previous=this.queue;let release;this.queue=new Promise(resolve=>release=resolve);
  await previous;
  try{await this.refresh();return await action();}
  catch(e){if(this.cloud.enabled)this.reload=true;throw e;}
  finally{release();}
 }
 async commit(){
  if(!this.cloud.enabled)return;
  const snapshot=this.file+'.snapshot-'+crypto.randomUUID();
  try{
   // Consistent snapshot, including any committed WAL contents.
   await run(this.db,'VACUUM INTO ?',[snapshot]);
   this.generation=await this.cloud.upload(snapshot,key,{generation:this.generation});
  }catch(e){
   this.reload=true;
   const error=Error(Number(e.code)===412?'Another upload completed first. Please retry; its saved data has been preserved.':'Cloud storage could not confirm the save. Please retry.');
   error.status=Number(e.code)===412?409:503;error.cause=e;throw error;
  }finally{if(fs.existsSync(snapshot))fs.unlinkSync(snapshot);}
 }
 async recoverSeed(){
  if(!this.cloud.enabled)return {recovered:0};
  const seedFile=path.join(this.seed,'papers.db');
  let recovered=0;
  if(fs.existsSync(seedFile)&&path.resolve(seedFile)!==path.resolve(this.file)){
   await checkDatabase(seedFile);
   await run(this.db,'ATTACH DATABASE ? AS recovery',[seedFile]);
   try{
    // Cloud records win on identical primary keys. Recover missing rows only.
    for(const table of ['papers','templates','generations','screenings','custom_departments','user_credentials','audit_events']){
     const exists=await all(this.db,"SELECT name FROM recovery.sqlite_master WHERE type='table' AND name=?",[table]);
     if(exists.length){
      const target=await all(this.db,`PRAGMA main.table_info(${table})`),seedColumns=await all(this.db,`PRAGMA recovery.table_info(${table})`);
      const columns=target.filter(c=>seedColumns.some(s=>s.name===c.name)).map(c=>'"'+c.name.replaceAll('"','""')+'"').join(',');
      const result=await run(this.db,`INSERT OR IGNORE INTO main.${table} (${columns}) SELECT ${columns} FROM recovery.${table}`);recovered+=result.changes;
     }
    }
   }finally{await run(this.db,'DETACH DATABASE recovery');}
  }
  const references=await all(this.db,'SELECT path FROM papers UNION SELECT path FROM templates UNION SELECT path FROM generations');
  // Persist documents before publishing metadata that refers to them.
  let index=0;
  await Promise.all(Array.from({length:4},async()=>{
   while(index<references.length){
    const record=references[index++],name=portableName(record.path),object='files/'+name;
    if(await this.cloud.metadata(object))continue;
    const local=[path.join(this.data,'files',name),path.join(this.seed,'files',name)].find(p=>fs.existsSync(p));
    if(!local)throw Error('Cannot recover a referenced document: '+name);
    await this.cloud.putDocument(local,object);
   }
  }));
  if(this.generation==='0'||recovered){
   if(this.generation!=='0'){
    const backup=path.join(this.data,'before-recovery-'+crypto.randomUUID()+'.db');
    try{
     fs.writeFileSync(backup,await this.cloud.download(key,this.generation));
     await this.cloud.upload(backup,'recovery/'+path.basename(backup));
    }finally{if(fs.existsSync(backup))fs.unlinkSync(backup);}
   }
   await this.commit();
  }
  return {recovered,documents:references.length};
 }
 async close(){await close(this.db);this.db=null;}
}
module.exports={PersistentData,portableName,checkDatabase,open,close,all,run};
