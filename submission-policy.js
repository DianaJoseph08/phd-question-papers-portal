const Zip=require('pizzip');
const {DOMParser}=require('@xmldom/xmldom');
const {inspect,text,isAnswerKeyHeading}=require('./papers');
function commonFor(d){
 if(d.is_common)return null;
 if(d.campus_id===1&&/engineering/i.test(d.institution))return 201;
 if(d.campus_id===2){if(/engineering/i.test(d.institution))return 202;if(/science.*humanities/i.test(d.institution))return -203;if(/allied|occupational|medical.*health/i.test(d.institution))return -204;}
 return null;
}
const placeholder=q=>/\b(?:the\s+)?question\s+starts?\s+here\b/i.test(q.text);
function inspectForDepartment(buffer,d,{includeAnswers=true}={}){
 const info=inspect(buffer,{subjectName:d.is_common?undefined:d.name,includeAnswers:false}),warnings=[];
 // A common-RM department may leave the unused RM template placeholders in place.
 if(d.common_rm_id&&info.questions.filter(q=>q.section==='subject').length===25){
  const unused=info.questions.filter(q=>q.section==='research'&&placeholder(q));
  if(unused.length){info.questions=info.questions.filter(q=>!unused.includes(q));warnings.push('Unused Research Methodology template placeholders were ignored. The coordinator supplies Common RM.');}
 }
 if(info.questions.length===25&&info.questions.every(q=>q.section==='unclassified')&&(d.is_common||d.common_rm_id)){
  info.questions.forEach(q=>q.section=d.is_common?'research':'subject');warnings.push('The section was identified from your assigned paper type. Please retain the section heading in future uploads.');
 }
 const counts={research:info.questions.filter(q=>q.section==='research').length,subject:info.questions.filter(q=>q.section==='subject').length};
 const unclassified=info.questions.filter(q=>q.section==='unclassified').length;if(unclassified)counts.unclassified=unclassified;
 const full=counts.research===25&&counts.subject===25&&!unclassified;
 const researchOnly=counts.research===25&&counts.subject===0&&!unclassified;
 const subjectOnly=counts.subject===25&&counts.research===0&&!unclassified;
 info.counts=counts;info.valid=(d.is_common?researchOnly:full||Boolean(d.common_rm_id&&subjectOnly))&&!info.questions.some(placeholder);
 info.paper_type=d.is_common?'common_rm':subjectOnly?'subject_only':'full';info.warnings=warnings;
 if(includeAnswers){const doc=new DOMParser().parseFromString(new Zip(buffer).file('word/document.xml').asText(),'application/xml');require('./answers').attachAnswers(doc,info.questions,isAnswerKeyHeading);}
 return info;
}
function validateTemplate(buffer,d,info){
 const errors=[],warnings=[...info.warnings];
 if(!info.valid)errors.push(d.is_common?'Provide 25 numbered Research Methodology questions.':d.common_rm_id?'Provide 25 numbered subject questions. Your assigned coordinator supplies Common RM. A complete 25 RM + 25 subject paper is also accepted.':'Provide 25 numbered Research Methodology questions and 25 numbered subject questions under their section headings.');
 const option_errors=[];
 function optionLabels(question){
  return new Set(require('./answers').layout(question.xml).options.map(o=>o.label));
 }
 info.questions.forEach((q,i)=>{
  const labels=optionLabels(q);
  const required=['A','B','C','D'],missing=required.filter(l=>!labels.has(l));
  if(missing.length){const question=q.source_number??q.number??q.display_number??i+1;option_errors.push({question,section:q.section,question_text:q.answer_diagnostics?.question_text||q.text,detected:[...labels].join(', ')||'None',missing:missing.join(', '),problem:'Option label is missing or not recognized',expected:'A) …  B) …  C) …  D) …'});}
 });
 const doc=new DOMParser().parseFromString(new Zip(buffer).file('word/document.xml').asText(),'application/xml');
 const key=Array.from(doc.getElementsByTagName('w:p')).some(p=>isAnswerKeyHeading(text(p).trim()));
 if(!key)warnings.push('No separate Answer Key heading detected. The administrator must check the supplied answers before approval.');
 const answer_errors=info.questions.filter(q=>q.answer_error).map(q=>require('./answers').answerRemark(q,info.questions.indexOf(q)));
 return {advisory:true,passed:errors.length===0,paper_type:info.paper_type,counts:info.counts,expected:d.is_common?'25 RM':d.common_rm_id?'25 subject (Common RM supplied separately)':'25 RM + 25 subject',checks:['Word .docx format','Numbered question count and sections','No unfilled question placeholders'],errors,warnings,option_errors,answer_errors};
}
module.exports={commonFor,inspectForDepartment,validateTemplate,placeholder};
