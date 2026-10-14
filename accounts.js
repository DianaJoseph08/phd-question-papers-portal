const crypto=require('crypto');
const {promisify}=require('util');
const {all,run}=require('./persistent-data');
const {canTrack}=require('./coordinators');
const scrypt=promisify(crypto.scrypt);
async function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');const key=await scrypt(password,salt,64);return `scrypt$${salt}$${key.toString('hex')}`;}
async function verifyHash(password,stored){
 const [method,salt,hex]=String(stored).split('$');if(method!=='scrypt'||!salt||! /^[a-f0-9]{128}$/.test(hex||''))return false;
 const expected=Buffer.from(hex,'hex'),actual=await scrypt(password,salt,64);return crypto.timingSafeEqual(actual,expected);
}
const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
function validateNewPassword(body){
 const password=body.new_password;
 if(typeof password!=='string'||password.length<12||password.length>128)throw Error('Use a password between 12 and 128 characters.');
 if(password!==body.confirm_password)throw Error('The new passwords do not match.');
 if('username' in body)throw Error('Your username cannot be changed.');
 return password;
}
class Accounts{
 constructor({db,users}){Object.assign(this,{db,users});this.base=users;}
 async ensure(){await run(this.db(),`CREATE TABLE IF NOT EXISTS portal_users (
  id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,email TEXT NOT NULL,
  role TEXT NOT NULL,campus_id INTEGER NOT NULL,department_id INTEGER,created_by INTEGER NOT NULL,created_at TEXT NOT NULL
 )`);await run(this.db(),`CREATE TABLE IF NOT EXISTS user_credentials (
  user_id INTEGER PRIMARY KEY,password_hash TEXT NOT NULL,version INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,changed_by INTEGER NOT NULL
 )`);}
 async load(){this.users=[...this.base,...await all(this.db(),'SELECT id,username,name,email,role,campus_id,department_id FROM portal_users ORDER BY name')];return this.users;}
 async createHod(body,campusId,adminId){
  const name=typeof body.name==='string'?body.name.trim():'',username=typeof body.username==='string'?body.username.trim():'',email=typeof body.email==='string'?body.email.trim():'';
  if(name.length<2||name.length>120)throw Error('Enter the new HoD name (2-120 characters).');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(username))throw Error('Use a username of 3-64 letters, numbers, dots, underscores or hyphens.');
  if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid HoD email address.');
  if(![1,2].includes(Number(campusId)))throw Error('Select the new HoD campus.');
  await this.load();if(this.users.some(u=>u.username.toLowerCase()===username.toLowerCase())){const e=Error('This username already exists. Choose another username or select the existing HoD.');e.status=409;throw e;}
  const password=validateNewPassword({new_password:body.new_password,confirm_password:body.confirm_password});
  const id=Math.max(9999,...this.users.map(u=>u.id))+1;
  await run(this.db(),'INSERT INTO portal_users VALUES (?,?,?,?,?,?,?,?,?)',[id,username,name,email,'hod',Number(campusId),null,adminId,new Date().toISOString()]);
  await this.setPassword(id,password,adminId,true);await this.load();return this.users.find(u=>u.id===id);
 }
 async credential(id){return (await all(this.db(),'SELECT * FROM user_credentials WHERE user_id=?',[id]))[0];}
 async verify(user,password){
  if(!user||typeof password!=='string'||password.length>128)return false;
  const c=await this.credential(user.id);
  return c?verifyHash(password,c.password_hash):Boolean(user.password)&&safeEqual(password.trim(),String(user.password));
 }
 async authenticate(username,password){
  const user=this.users.find(u=>u.username.toLowerCase()===String(username||'').trim().toLowerCase());
  if(!await this.verify(user,password))return null;
  const credential=await this.credential(user.id);
  const {password:ignored,...publicUser}=user;
  return {user:{...publicUser,must_change_password:Boolean(credential?.must_change_password)},version:credential?.version||0};
 }
 async validSession(id,version){return ((await this.credential(id))?.version||0)===version;}
 async setPassword(id,password,changedBy,mustChange=false){
  const version=((await this.credential(id))?.version||0)+1;
  await run(this.db(),'INSERT OR REPLACE INTO user_credentials VALUES (?,?,?,?,?,?)',[id,await hashPassword(password),version,mustChange?1:0,new Date().toISOString(),changedBy]);
  return version;
 }
 async list(departments){
  const credentials=new Map((await all(this.db(),'SELECT user_id,must_change_password,updated_at FROM user_credentials')).map(c=>[c.user_id,c]));
  return this.users.map(({password:ignored,...u})=>{
   const c=credentials.get(u.id);
   return {...u,password_status:c?(c.must_change_password?'Change required':'Changed securely'):'Existing admission password',password_updated_at:c?.updated_at||null,departments:departments.filter(d=>canTrack(u,d)||(d.is_common?d.coordinator_id===u.id:d.is_custom?d.hod_user_id===u.id:d.id===u.department_id)).map(d=>d.name+' · '+d.campus)};
  });
 }
}
module.exports={Accounts,hashPassword,verifyHash,validateNewPassword};
