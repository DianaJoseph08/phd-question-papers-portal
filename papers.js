const Zip = require('pizzip');
const {DOMParser, XMLSerializer} = require('@xmldom/xmldom');
const crypto = require('crypto');
const {attachAnswers,layout}=require('./answers');
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const parse = x => new DOMParser().parseFromString(x,'application/xml');
const serialize = n => new XMLSerializer().serializeToString(n);
function text(n) {let result='';function visit(node){if(['w:t','m:t'].includes(node.nodeName))result+=node.textContent;else if(['w:br','w:cr'].includes(node.nodeName))result+='\n';else if(node.nodeName==='w:tab')result+='\t';else for(let child=node.firstChild;child;child=child.nextSibling)visit(child);}visit(n);return result;}
const isAnswerKeyHeading=t=>t.length<100&&(/answer\s*key\s*$/i.test(t)||/^answer\s*key\b/i.test(t));
function inspect(buffer,{subjectName,includeAnswers=true}={}) {
 const zip=new Zip(buffer); const entry=zip.file('word/document.xml');
 if(!entry) throw Error('Upload a valid Word .docx document.');
 if(entry.asText().length>15000000) throw Error('Document is too large to process.');
 const doc=parse(entry.asText()); const paragraphs=Array.from(doc.getElementsByTagName('w:p'));
 // The paper's marks summary is metadata, even when its cells contain section names and numbers.
 const summaryTables=new Set(Array.from(doc.getElementsByTagName('w:tbl')).filter(table=>{
  const row=Array.from(table.childNodes).find(n=>n.nodeName==='w:tr');if(!row)return false;
  const labels=Array.from(row.getElementsByTagName('w:tc')).map(cell=>text(cell).toLowerCase().replace(/\s+/g,' ').trim());
  return labels.includes('number of questions')&&labels.includes('total marks')&&(labels.includes('section')||labels.includes('topic'));
 }));
 function inSummary(p){for(let node=p.parentNode;node;node=node.parentNode)if(summaryTables.has(node))return true;return false;}
 const numbering=zip.file('word/numbering.xml');
 const numberDoc=numbering?parse(numbering.asText()):null;
 const listCounters=new Map();
 function listInfo(p,requestedLevel){
  const id=p.getElementsByTagName('w:numId')[0]?.getAttribute('w:val');
  const level=requestedLevel??p.getElementsByTagName('w:ilvl')[0]?.getAttribute('w:val')??'0';
  if(!numberDoc||!id)return null;
  const num=Array.from(numberDoc.getElementsByTagName('w:num')).find(n=>n.getAttribute('w:numId')===id);
  const aid=num?.getElementsByTagName('w:abstractNumId')[0]?.getAttribute('w:val');
  const abstract=Array.from(numberDoc.getElementsByTagName('w:abstractNum')).find(n=>n.getAttribute('w:abstractNumId')===aid);
  const override=num&&Array.from(num.getElementsByTagName('w:lvlOverride')).find(n=>n.getAttribute('w:ilvl')===level);
  const lvl=override?.getElementsByTagName('w:lvl')[0]||(abstract&&Array.from(abstract.getElementsByTagName('w:lvl')).find(n=>n.getAttribute('w:ilvl')===level));
  if(!lvl)return null;
  const start=Number(override?.getElementsByTagName('w:startOverride')[0]?.getAttribute('w:val')||lvl.getElementsByTagName('w:start')[0]?.getAttribute('w:val')||1);
  return {id,level:Number(level),format:lvl.getElementsByTagName('w:numFmt')[0]?.getAttribute('w:val'),start,restart:lvl.getElementsByTagName('w:lvlRestart')[0]?.getAttribute('w:val')};
 }
 const format=p=>listInfo(p)?.format;
 const heading=t=>{
  if(/^(?:(?:part|section)\s*[a1][.:) –—-]*\s*)?research\s+methodology\b/i.test(t))return 'research';
  if(/^(?:(?:part|section)\s*[b2][.:) –—-]*\s*)?subject[ -]specific(?:\s+(?:questions|core\s+topics))?(?=\s*(?:$|\(|[0-9]))/i.test(t))return 'subject';
  // Department-specific Section B headings (for example “Section B: Mathematics”).
  // Once Section A is Research Methodology, the paired Section B is the subject block.
  const paired=t.match(/^(?:part|section)\s*[b2][.:) –—-]+(.+)$/i);
  if(paired&&!/research\s+methodology/i.test(paired[1]))return 'subject';
  if(/^mathematics(?:\s+\(|\s+-|\s*$)/i.test(t))return 'subject';
  // A standalone department title is also a subject heading in its assigned paper.
  const title=t.replace(/\s*\((?:\d+\s*(?:questions?|marks?)|subject[^)]*)\)\s*$/i,'').replace(/\s+questions?\s*$/i,'').trim();
  if(subjectName&&title.toLowerCase()===subjectName.trim().toLowerCase())return 'subject';
  return null;
 };
 const hasSections=paragraphs.some(p=>!inSummary(p)&&!p.getElementsByTagName('w:numPr').length&&heading(text(p).trim()));
 function firstQuestionCell(p,t){
  if(!/^1[.)]?$/.test(t))return false;
  let cell=p.parentNode;while(cell&&cell.nodeName!=='w:tc')cell=cell.parentNode;
  if(!cell||cell.parentNode?.nodeName!=='w:tr')return false;
  const cells=Array.from(cell.parentNode.childNodes).filter(n=>n.nodeName==='w:tc');
  return cells[0]===cell&&cells.length>1&&cells.slice(1).some(c=>text(c).trim()||c.getElementsByTagName('w:drawing').length||c.getElementsByTagName('w:pict').length);
 }
 let section=null,pending=[],questions=[],started=false,number=null,displayNumber=null;
 function flush(){if(!pending.length)return;const combined=pending.map(x=>text(parse(x))).join('\n');questions.push({section:section||'unclassified',number,display_number:displayNumber,xml:pending.join(''),text:combined,hash:crypto.createHash('sha256').update(combined.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')).digest('hex')});pending=[];}
 for(const [paragraphIndex,p] of paragraphs.entries()){
  if(inSummary(p))continue;
  // Nested textbox paragraphs are visited separately, never counted twice.
  const t=text(p).trim(),nextSection=p.getElementsByTagName('w:numPr').length?null:heading(t);
  if((started||section)&&isAnswerKeyHeading(t)){flush();break;}
  if(p.getElementsByTagName('w:p').length)continue;
  if(nextSection){flush();section=nextSection;started=false;continue;}
  if(hasSections&&!section)continue;
  if(/^\(?25\s*(?:[×x]|1\s*=)/i.test(t))continue;
  if(!t&&!p.getElementsByTagName('w:drawing').length&&!p.getElementsByTagName('m:oMath').length&&!p.getElementsByTagName('w:pict').length)continue;
  const list=listInfo(p),lettered=['lowerLetter','upperLetter'].includes(list?.format);
  let listNumber=null;
  if(list){
   for(const key of listCounters.keys())if(key.startsWith(list.id+'|')&&Number(key.split('|')[1])>list.level){const child=listInfo(p,key.split('|')[1]);if(child?.restart!=='0')listCounters.delete(key);}
   const key=list.id+'|'+list.level;listNumber=listCounters.has(key)?listCounters.get(key)+1:list.start;listCounters.set(key,listNumber);
  }
  // The visible Word list label determines the role; a numeric option body is not a question.
  let manual=lettered?null:t.match(/^(?:Q(?:uestion)?\s*\.?\s*)?(\d{1,3})\s*[.)]\s*(?!\d)/i)||t.match(/^(\d{1,3})$/);
  if(manual&&/^\d{1,3}$/.test(t)&&pending.length){
   let cell=p.parentNode;while(cell&&cell.nodeName!=='w:tc')cell=cell.parentNode;
   const cells=cell?Array.from(cell.parentNode.childNodes).filter(n=>n.nodeName==='w:tc'):[];
   const previous=layout(pending.join('')).options;
   const questionCell=cells.length>1&&cells[0]===cell&&cells.slice(1).some(c=>text(c).trim().length>15);
   const numberedNext=number!==null&&Number(t)===number+1&&(questionCell||['A','B','C','D'].every(label=>previous.some(o=>o.label===label)));
   if(!numberedNext)manual=null;
  }
  // A bare question number is accepted only with a complete labelled option block ahead.
  // This avoids treating a numerical value in an option or continuation as a question.
  const bare=t.match(/^(?:Q(?:uestion)?[ \t]+)?(\d{1,3})[ \t]+(?=[\p{L}(])/iu);
  const previousLabels=new Set();if(bare&&pending.length)for(const m of pending.map(x=>text(parse(x))).join('\n').matchAll(/(?:^|(?<=\s))(?:\(([A-Da-d])\)|([A-Da-d])[.):])[ \t]*/g))previousLabels.add((m[1]||m[2]).toUpperCase());
  const followsQuestion=!pending.length||((number===null||Number(bare?.[1])===number+1)&&['A','B','C','D'].every(label=>previousLabels.has(label)));
  if(!manual&&bare&&followsQuestion&&!(pending.length&&['lowerLetter','upperLetter'].includes(format(p)))){
   const labels=new Set();let found=false;
   for(let index=paragraphIndex+1;index<Math.min(paragraphs.length,paragraphIndex+12);index++){
    const ahead=text(paragraphs[index]).trim();
    if(heading(ahead)||isAnswerKeyHeading(ahead)||/^(?:Q(?:uestion)?\s*\.?\s*)?\d{1,3}[.)]\s*\D/i.test(ahead))break;
    for(const m of ahead.matchAll(/(?:^|(?<=\s))(?:\(([A-Da-d])\)|([A-Da-d])[.):])[ \t]*/g))labels.add((m[1]||m[2]).toUpperCase());
    if(['A','B','C','D'].every(label=>labels.has(label))){found=true;break;}
   }
   if(found)manual=bare;
  }
  const automatic=['decimal','decimalZero'].includes(list?.format);
  const questionLike=/[?？]|\b[A-D][.)]\s|^(which|what|how|why|define|explain|identify|describe)\b/i.test(t);
  const boundary=(manual||automatic)&&(section||started||questionLike||firstQuestionCell(p,t));
  if(boundary){flush();number=manual?Number(manual[1]):null;displayNumber=number??listNumber;started=true;}
  if(!started)continue;
  if(!t&&!p.getElementsByTagName('w:drawing').length&&!p.getElementsByTagName('m:oMath').length&&!p.getElementsByTagName('w:pict').length)continue;
  let xml=serialize(p);
  if(['lowerLetter','upperLetter'].includes(format(p))&&pending.length&&!/^\(?[A-Da-d][.)]/.test(t)){
   const label=String.fromCharCode(65+(listNumber-1))+') ';
   const cloned=p.cloneNode(true),r=doc.createElementNS(ns,'w:r'),tNode=doc.createElementNS(ns,'w:t');
   tNode.setAttribute('xml:space','preserve');tNode.appendChild(doc.createTextNode(label));r.appendChild(tNode);
   const pPr=cloned.getElementsByTagName('w:pPr')[0];cloned.insertBefore(r,pPr?pPr.nextSibling:cloned.firstChild);xml=serialize(cloned);
  }
  pending.push(xml);
 }
 flush();
 if(includeAnswers)attachAnswers(doc,questions,isAnswerKeyHeading);
 const counts={research:questions.filter(q=>q.section==='research').length,subject:questions.filter(q=>q.section==='subject').length};
 const unclassified=questions.filter(q=>q.section==='unclassified').length;if(unclassified)counts.unclassified=unclassified;
 const placeholders=questions.some(q=>/\b(?:the\s+)?question\s+starts?\s+here\b/i.test(q.text));
 return {questions,counts,valid:counts.research===25&&counts.subject===25&&!unclassified&&!placeholders,method:'question-numbering'};
}

function choose(pools, single=false, finalSet='A',common=false,sectionCampuses=null) {
 const selected=[],seen=new Set();
 const shuffle=a=>a.map(v=>({v,n:crypto.randomInt(2147483647)})).sort((a,b)=>a.n-b.n).map(x=>x.v);
 for(const section of (common?['research']:['research','subject'])) {
  for(let campus=1;campus<=2;campus++) {
   const planned=sectionCampuses?.[section],sectionSingle=planned?planned.length===1:single;
   const highCampus=common||sectionCampuses?(finalSet==='A'?1:2):1;
   const need=sectionSingle?((planned?planned.includes(campus):pools.some(p=>p.campus===campus))?25:0):(common||section==='research'?(campus===highCampus?13:12):(campus===highCampus?12:13));
   const campusPools=pools.filter(p=>p.campus===campus&&(!p.section||p.section===section));
   if(campusPools.some(p=>p.set_name)) {
    const firstSet=finalSet==='A'?'A':'B';
    const firstQuota=section==='research'?Math.ceil(need/2):Math.floor(need/2);
    for(const sourceSet of ['A','B']){
     const quota=sourceSet===firstSet?firstQuota:need-firstQuota;
     const sourcePools=campusPools.filter(p=>p.set_name===sourceSet).sort((a,b)=>(a.department_id||0)-(b.department_id||0));
     for(let index=0;index<sourcePools.length;index++){
      const p=sourcePools[index],required=Math.floor(quota/sourcePools.length)+(index<quota%sourcePools.length?1:0);
      const candidates=shuffle(p.questions.filter(q=>q.section===section).map(q=>({...q,source:q.source||p})));let added=0;
      for(const q of candidates)if(!seen.has(q.hash)&&added<required){seen.add(q.hash);selected.push(q);added++;}
      if(added!==required)throw Error('Insufficient unique '+section+' questions in department '+p.department_id+', campus '+campus+', Set '+sourceSet+': need '+required+', available '+added+'.');
     }
     if(quota&&!sourcePools.length)throw Error('Missing source Set '+sourceSet+' in campus '+campus+'.');
    }
    continue;
   }
   const candidates=shuffle(campusPools.flatMap(p=>p.questions.filter(q=>q.section===section).map(q=>({...q,source:q.source||p}))));
   let added=0;
   for(const q of candidates) if(!seen.has(q.hash)&&added<need){seen.add(q.hash);selected.push(q);added++;}
   if(added!==need) throw Error(`Insufficient unique ${section} questions from ${campus===1?'Ramapuram':'Trichy'}: need ${need}, available ${added}.`);
  }
 }
 return selected;
}
function generate(selected,title,set,templateBuffer,context={}) {return require('./template-paper').generateFromTemplate(selected,title,set,templateBuffer,context);}
module.exports={inspect,choose,generate,text,isAnswerKeyHeading};
