const crypto=require('crypto');
const {promisify}=require('util');
const {all,run}=require('./persistent-data');
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
 constructor({db,users}){Object.assign(this,{db,users});}
 async ensure(){await run(this.db(),`CREATE TABLE IF NOT EXISTS user_credentials (
  user_id INTEGER PRIMARY KEY,password_hash TEXT NOT NULL,version INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,changed_by INTEGER NOT NULL
 )`);}
 async credential(id){return (await all(this.db(),'SELECT * FROM user_credentials WHERE user_id=?',[id]))[0];}
 async verify(user,password){
  if(!user||typeof password!=='string'||password.length>128)return false;
  const c=await this.credential(user.id);
  return c?verifyHash(password,c.password_hash):safeEqual(password.trim(),String(user.password||''));
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
   return {...u,password_status:c?(c.must_change_password?'Change required':'Changed securely'):'Existing admission password',password_updated_at:c?.updated_at||null,departments:departments.filter(d=>d.is_common?d.coordinator_id===u.id:d.is_custom?d.hod_user_id===u.id:d.id===u.department_id).map(d=>d.name+' · '+d.campus)};
  });
 }
}
module.exports={Accounts,hashPassword,verifyHash,validateNewPassword};
