const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parse=xml=>new DOMParser().parseFromString(xml,'application/xml');
const serialize=n=>new XMLSerializer().serializeToString(n);
function content(node){let result='';function visit(n){if(['w:t','m:t'].includes(n.nodeName))result+=n.textContent;else if(['w:br','w:cr'].includes(n.nodeName))result+='\n';else if(n.nodeName==='w:tab')result+='\t';else for(let c=n.firstChild;c;c=c.nextSibling)visit(c);}visit(node);return result;}
function questionDoc(xml){return parse(`<root xmlns:w="${ns}">${xml}</root>`);}
function layout(xml){
 const doc=questionDoc(xml),runs=[],parts=[];let position=0;
 for(const p of Array.from(doc.getElementsByTagName('w:p'))){
  function visit(n){if(['w:r','m:r'].includes(n.nodeName)){const value=content(n);runs.push({node:n,start:position,end:position+value.length,text:value});parts.push(value);position+=value.length;}else for(let c=n.firstChild;c;c=c.nextSibling)visit(c);}visit(p);
  parts.push('\n');position++;
 }
 const text=parts.join(''),matches=[...text.matchAll(/(?:^|(?<=\s))(?:\(([A-Da-d])\)[.:]?|([A-Da-d])[ \t]*[.):：\-–—])[ \t]*/g)];
 const options=matches.map((m,i)=>({label:(m[1]||m[2]).toUpperCase(),start:m.index,body:m.index+m[0].length,end:matches[i+1]?matches[i+1].index:text.length}));
 return {doc,text,runs,options};
}
function boldValue(r){const b=r.getElementsByTagName('w:rPr')[0]?.getElementsByTagName('w:b')[0];return Boolean(b&&!['0','false','off'].includes(b.getAttribute('w:val')));}
function boldAnswer(l){
 const candidates=l.options.filter(o=>{
  const pieces=l.runs.filter(r=>r.end>o.body&&r.start<o.end).map(r=>({r,value:r.text.slice(Math.max(0,o.body-r.start),Math.min(r.text.length,o.end-r.start))})).filter(p=>p.value.trim());
  return pieces.length&&pieces.every(p=>boldValue(p.r.node));
 });
 return candidates.length===1?candidates[0].label:null;
}
const scopeFor=s=>/research\s+methodology|section\s*a\b/i.test(s)?'research':/subject|section\s*b\b/i.test(s)?'subject':null;
function attachAnswers(doc,questions,isHeading){
 const keys=new Map();let inKey=false,scope='global';
 function record(number,value){
  if(!/^\d{1,3}$/.test(String(number).trim()))return;
  const raw=String(value).trim();if(!raw)return;
  const m=raw.match(/^(?:(?:correct\s*(?:option|answer)|ans(?:wer)?)\s*[:=-]?\s*)?\(?([A-D])\)?[.)]?$/i);
  const key=scope+'|'+Number(number),values=keys.get(key)||new Set();values.add(m?m[1].toUpperCase():'invalid');keys.set(key,values);
 }
 function visit(n){
  if(n.nodeName==='w:p'){
   const value=content(n).trim();if(isHeading(value)){inKey=true;scope=scopeFor(value)||'global';return;}
   if(!inKey)return;
   const nextScope=scopeFor(value);if(nextScope&&value.length<100){scope=nextScope;return;}
   for(const m of value.matchAll(/(?:^|[\s;,])(\d{1,3})\s*[.):=-]?\s*\(?([A-D])\)?(?=$|[\s;,])/gi))record(m[1],m[2]);
   return;
  }
  if(n.nodeName==='w:tbl'&&inKey){
   for(const row of Array.from(n.childNodes).filter(c=>c.nodeName==='w:tr')){
    const cells=Array.from(row.childNodes).filter(c=>c.nodeName==='w:tc').map(c=>content(c).trim());
    for(let i=0;i+1<cells.length;i+=2)record(cells[i],cells[i+1]);
   }
   return;
  }
  for(let c=n.firstChild;c;c=c.nextSibling)visit(c);
 }
 visit(doc.documentElement);
 const globalNumbers=[...keys.keys()].filter(k=>k.startsWith('global|')).map(k=>Number(k.split('|')[1]));
 const sections=new Set(questions.map(q=>q.section)),numberUnique=questions.every(q=>q.number!==null)&&new Set(questions.map(q=>q.number)).size===questions.length;
 const restarted=sections.size>1&&!numberUnique,globalAmbiguous=restarted&&globalNumbers.length&&!globalNumbers.some(n=>n>25);
 const sectionCounts={};
 questions.forEach((q,index)=>{
  const local=(sectionCounts[q.section]||0)+1;sectionCounts[q.section]=local;
  const l=layout(q.xml),bold=boldAnswer(l),scoped=keys.has(q.section+'|'+(q.number??local))?q.number??local:local;
  let keyNumber=numberUnique?q.number:index+1;
  if(sections.size===1&&q.section==='subject'&&!globalNumbers.some(n=>n<=25)&&globalNumbers.some(n=>n>=26))keyNumber=q.number>=26?q.number:local+25;
  const specific=keys.get(q.section+'|'+scoped),entry=specific||keys.get('global|'+keyNumber);
  let error=null,answer=null,source=null;
  if(!specific&&globalAmbiguous)error='Answer key repeats question numbers without identifying RM and subject sections.';
  else if(entry?.has('invalid')||entry?.size>1)error='The source answer key is invalid or contains conflicting answers for this question.';
  else if(entry?.size){answer=[...entry][0];source='answer_key';if(bold&&bold!==answer)error='The source answer key and the bold option disagree.';}
  else if(bold){answer=bold;source='bold_option';}
  else error='No unambiguous correct answer was found in the source key or bold options.';
  if(answer&&(['A','B','C','D'].some(label=>l.options.filter(o=>o.label===label).length!==1)))error='The answer cannot be marked reliably: identify each option once using A, B, C and D.';
  Object.assign(q,{source_number:q.number??local,answer:error?null:answer,answer_source:source,answer_key_number:entry?(specific?scoped:keyNumber):null,answer_error:error});
 });
 return questions;
}
function markedQuestion(xml,answer,number=null){
 const l=layout(xml),target=l.options.find(o=>o.label===answer);
 if(!target)throw Error('The correct answer option cannot be located.');
 // Remove the old source question number; generation supplies one final number.
 const prefix=number!==null?l.text.match(/^[ \t]*(?:Q(?:uestion)?[ \t]*\.?[ \t]*)?\d{1,3}[ \t]*[.)]?[ \t]*/i):null;
 // Work with original offsets until option runs have been split.
 for(const run of l.runs){
  let cursor=run.start;
  const replacement=[];
  function piece(child,bold){
   const r=run.node.cloneNode(false),pr=run.node.getElementsByTagName('w:rPr')[0]?.cloneNode(true)||l.doc.createElementNS(ns,'w:rPr');
   for(const tag of ['w:b','w:bCs'])for(const n of Array.from(pr.getElementsByTagName(tag)))n.parentNode.removeChild(n);
   for(const tag of ['w:b','w:bCs']){const b=l.doc.createElementNS(ns,tag);b.setAttribute('w:val',bold?'1':'0');pr.appendChild(b);}
   if(run.node.nodeName==='m:r'){
    const mathNs='http://schemas.openxmlformats.org/officeDocument/2006/math',mpr=run.node.getElementsByTagName('m:rPr')[0]?.cloneNode(true)||l.doc.createElementNS(mathNs,'m:rPr');
    const previousStyle=mpr.getElementsByTagName('m:sty')[0]?.getAttribute('m:val');
    for(const old of Array.from(mpr.getElementsByTagName('m:sty')))old.parentNode.removeChild(old);
    const nextStyle=bold?'b':previousStyle==='b'?'p':previousStyle==='bi'?'i':previousStyle;
    if(nextStyle){const sty=l.doc.createElementNS(mathNs,'m:sty');sty.setAttribute('m:val',nextStyle);mpr.appendChild(sty);}
    r.appendChild(mpr);
   }
   r.appendChild(pr);r.appendChild(child);replacement.push(r);
  }
  for(const child of Array.from(run.node.childNodes)){
   if(['w:rPr','m:rPr'].includes(child.nodeName))continue;
   const value=content(child),end=cursor+value.length;
   if(['w:t','m:t'].includes(child.nodeName)){
    const cuts=[cursor,end,...[target.start,target.end].filter(n=>n>cursor&&n<end)].sort((a,b)=>a-b);
    for(let i=0;i<cuts.length-1;i++){
     const t=child.cloneNode(false);t.setAttribute('xml:space','preserve');t.appendChild(l.doc.createTextNode(value.slice(cuts[i]-cursor,cuts[i+1]-cursor)));piece(t,cuts[i]>=target.start&&cuts[i]<target.end);
    }
   }else piece(child.cloneNode(true),cursor>=target.start&&cursor<target.end);
   cursor=end;
  }
  for(const r of replacement)run.node.parentNode.insertBefore(r,run.node);
  run.node.parentNode.removeChild(run.node);
 }
 if(prefix){
  let remaining=prefix[0].length;
  for(const t of Array.from(l.doc.getElementsByTagName('w:t'))){if(!remaining)break;const amount=Math.min(t.textContent.length,remaining);t.textContent=t.textContent.slice(amount);remaining-=amount;}
 }
 const paragraphs=Array.from(l.doc.getElementsByTagName('w:p')).filter(p=>!p.getElementsByTagName('w:p').length);
 paragraphs.forEach((p,index)=>{
  let pr=Array.from(p.childNodes).find(n=>n.nodeName==='w:pPr');if(!pr){pr=l.doc.createElementNS(ns,'w:pPr');p.insertBefore(pr,p.firstChild);}
  for(const tag of ['w:keepNext','w:keepLines'])for(const old of Array.from(pr.getElementsByTagName(tag)))old.parentNode.removeChild(old);
  pr.appendChild(l.doc.createElementNS(ns,'w:keepLines'));
  if(index<paragraphs.length-1)pr.appendChild(l.doc.createElementNS(ns,'w:keepNext'));
 });
 return Array.from(l.doc.documentElement.childNodes).map(serialize).join('');
}
module.exports={attachAnswers,markedQuestion,layout};
