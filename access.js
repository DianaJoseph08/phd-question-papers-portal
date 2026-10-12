const admin=u=>['admin','super_admin'].includes(u.role);
const canManageDepartments=u=>admin(u)&&(u.role==='super_admin'||['suresh','ruby'].includes(String(u.username||'').toLowerCase()));
const scope=(u,d)=>Boolean(d)&&(admin(u)||(d.is_common
 ?u.role==='coordinator'&&u.id===d.coordinator_id&&u.campus_id===d.campus_id
 :u.role==='hod'&&(d.is_custom?u.id===d.hod_user_id:u.department_id===d.id)&&u.campus_id===d.campus_id));
const canSubmit=(u,d)=>!admin(u)&&scope(u,d);
module.exports={admin,scope,canSubmit,canManageDepartments};
