const {Storage}=require('@google-cloud/storage');
const fs=require('fs');

// Never acknowledge a local-only save on an ephemeral Cloud Run container.
function createCloudStorage({env=process.env,bucket:providedBucket}={}){
 const enabled=Boolean(providedBucket||env.K_SERVICE||env.GCS_BUCKET_NAME||env.GAE_ENV);
 const name=env.GCS_BUCKET_NAME;
 let bucket=providedBucket;
 function getBucket(){
  if(!enabled)return null;
  if(!bucket){
   if(!name)throw Error('Set GCS_BUCKET_NAME to the private storage bucket before starting Cloud Run.');
   bucket=new Storage().bucket(name);
  }
  return bucket;
 }
 async function metadata(key){
  const b=getBucket();if(!b)return null;
  try{return (await b.file(key).getMetadata())[0];}catch(e){if(Number(e.code)===404)return null;throw e;}
 }
 async function download(key,generation){
  const b=getBucket();if(!b)return null;
  return (await b.file(key,generation?{generation}:{}).download())[0];
 }
 async function upload(file,key,{generation=0}={}){
  const b=getBucket();if(!b)return null;
  const [saved,response]=await b.upload(file,{destination:key,resumable:false,
   preconditionOpts:{ifGenerationMatch:generation},metadata:{cacheControl:'no-store'}});
  const generationSaved=response?.generation||saved.metadata?.generation;
  if(!generationSaved)throw Error('Cloud upload did not return a generation; reload before retrying.');
  return String(generationSaved);
 }
 async function putDocument(file,key){
  if(!enabled)return;
  if(!fs.existsSync(file))throw Error('Document is missing from local storage.');
  try{await upload(file,key);}catch(e){if(Number(e.code)!==412)throw e;}
 }
 async function getBufferFromCloudStorage(key){
  const m=await metadata(key);return m?download(key,m.generation):null;
 }
 return {enabled,BUCKET_NAME:name,metadata,download,upload,putDocument,getBufferFromCloudStorage};
}
module.exports={...createCloudStorage(),createCloudStorage};
