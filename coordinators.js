// Tracking responsibilities do not grant permission to submit a department's paper.
const assignments={
 sutha:{campus_id:1,campus:'Ramapuram',faculty:'science',label:'Faculty of Science and Humanities'},
 vani:{campus_id:1,campus:'Ramapuram',faculty:'engineering',label:'Faculty of Engineering and Technology'},
 priya:{campus_id:1,campus:'Ramapuram',faculty:'management',label:'Faculty of Management'},
 deepika:{campus_id:1,campus:'Ramapuram',faculty:'dental',label:'Dentistry'},
 infant:{campus_id:2,campus:'Trichy',faculty:'all',label:'All institutes and departments'},
};
function coordinatorAssignment(user){
 const assignment=user?.role==='coordinator'&&assignments[String(user.username||'').toLowerCase()];
 return assignment&&user.campus_id===assignment.campus_id?{...assignment}:null;
}
function faculty(d){
 const name=d.institution||'';
 if(/engineering/i.test(name))return 'engineering';
 if(/management/i.test(name))return 'management';
 if(/dental|dentistry/i.test(name))return 'dental';
 // The admissions database calls Ramapuram S&H Liberal Arts and Business Studies.
 if(/science.*humanities|humanities.*science|liberal\s+arts/i.test(name))return 'science';
 return null;
}
function canTrack(user,department){
 const assignment=coordinatorAssignment(user);
 return Boolean(assignment&&department&&department.campus_id===assignment.campus_id&&
  (assignment.faculty==='all'||assignment.faculty===faculty(department)));
}
module.exports={coordinatorAssignment,canTrack};
