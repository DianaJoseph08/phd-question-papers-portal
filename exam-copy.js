const Zip=require('pizzip');
const {XMLSerializer}=require('@xmldom/xmldom');
const {inspect,text,isAnswerKeyHeading}=require('./papers');
const {layout}=require('./answers');
const {hasKeyTableLabels}=require('./localized-headings');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children=n=>Array.from(n.childNodes).filter(c=>c.nodeType===1);
function normalOption(run){
 const doc=run.ownerDocument;
 let properties=children(run).find(n=>n.nodeName==='w:rPr');
 if(!properties){properties=doc.createElementNS(W,'w:rPr');const mathPr=children(run).find(n=>n.nodeName==='m:rPr');run.insertBefore(properties,mathPr?mathPr.nextSibling:run.firstChild);}
 for(const tag of ['w:b','w:bCs']){
  for(const old of Array.from(properties.getElementsByTagName(tag)))old.parentNode.removeChild(old);
  const off=doc.createElementNS(W,tag);off.setAttribute('w:val','0');properties.appendChild(off);
 }
 if(run.nodeName==='m:r'){
  const properties=children(run).find(n=>n.nodeName==='m:rPr');
  for(const style of properties?Array.from(properties.getElementsByTagName('m:sty')):[]){
   const current=style.getAttribute('m:val');
   if(current==='b'||current==='bi')style.setAttribute('m:val',current==='bi'?'i':'p');
  }
 }
}
function removeOptionBold(question){
 const l=layout(question.xml),runs=[];
 function visit(node){if(['w:r','m:r'].includes(node.nodeName))runs.push(node);else for(const child of children(node))visit(child);}
 question.paragraphs.forEach(visit);
 if(l.options.length!==4||new Set(l.options.map(o=>o.label)).size!==4||runs.length!==l.runs.length||runs.some((r,i)=>text(r)!==l.runs[i].text))throw Error('The saved paper has an unsupported option layout. Its exam copy could not be prepared safely.');
 const start=l.options[0].start;
 runs.forEach((run,index)=>{
  const range=l.runs[index];
  if(range.end<=start&&range.start<start)return;
  if(range.start>=start){normalOption(run);return;}
  // Older saved papers can have the stem and option A in the same text run.
  // Split that boundary so bold emphasis in the question itself is retained.
  let cursor=range.start;
  for(const child of Array.from(run.childNodes)){
   if(['w:rPr','m:rPr'].includes(child.nodeName))continue;
   const value=text(child),end=cursor+value.length;
   const cuts=['w:t','m:t'].includes(child.nodeName)?[cursor,...(start>cursor&&start<end?[start]:[]),end]:[cursor,end];
   for(let i=0;i<cuts.length-1;i++){
    const copy=run.cloneNode(false);
    for(const pr of children(run).filter(n=>['w:rPr','m:rPr'].includes(n.nodeName)))copy.appendChild(pr.cloneNode(true));
    const content=child.cloneNode(true);
    if(['w:t','m:t'].includes(child.nodeName)){content.textContent=value.slice(cuts[i]-cursor,cuts[i+1]-cursor);content.setAttribute('xml:space','preserve');}
    copy.appendChild(content);if(cuts[i]>=start)normalOption(copy);run.parentNode.insertBefore(copy,run);
   }
   cursor=end;
  }
  run.parentNode.removeChild(run);
 });
}
function examCopy(buffer,{subjectName}={}){
 const zip=new Zip(buffer),parsed=inspect(buffer,{subjectName,includeAnswers:false,includeNodes:true});
 if(!parsed.questions.length)throw Error('The saved Word paper has no readable questions. An exam copy cannot be prepared.');
 const doc=parsed.document,body=doc.getElementsByTagName('w:body')[0],paragraphs=Array.from(doc.getElementsByTagName('w:p'));
 const originalText=parsed.questions.map(q=>q.paragraphs.map(text).join('\n'));
 const last=parsed.questions.at(-1).paragraphs.at(-1),lastIndex=paragraphs.indexOf(last);
 let key=paragraphs.find((p,i)=>i>lastIndex&&isAnswerKeyHeading(text(p).trim()));
 if(!key)throw Error('The saved paper’s answer-key section could not be located. Its marked copy remains available.');
 while(key.parentNode!==body&&key.parentNode)key=key.parentNode;
 const blocks=children(body),keyIndex=blocks.indexOf(key);
 if(keyIndex<0)throw Error('The answer-key section has an unsupported layout.');
 const keyTables=blocks.map((n,i)=>({n,i})).filter(({n,i})=>i>keyIndex&&n.nodeName==='w:tbl'&&hasKeyTableLabels(text(n)));
 // Current templates use a key table; older generated papers may use paragraphs.
 const end=keyTables.length?keyTables.at(-1).i:blocks.length-1;
 for(const node of blocks.slice(keyIndex,end+1))if(node.nodeName!=='w:sectPr')body.removeChild(node);
 parsed.questions.forEach(removeOptionBold);
 const remaining=new Set(Array.from(doc.getElementsByTagName('w:p')));
 if(parsed.questions.some(q=>q.paragraphs.some(p=>!remaining.has(p)))||JSON.stringify(parsed.questions.map(q=>q.paragraphs.map(text).join('\n')))!==JSON.stringify(originalText))throw Error('Exam-copy verification failed: question text or order changed.');
 zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));
 return zip.generate({type:'nodebuffer'});
}
module.exports={examCopy};
