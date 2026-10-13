const Zip=require('pizzip'),fs=require('fs'),{DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const {layout,markedQuestion}=require('./answers');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/package/2006/relationships';
const parse=xml=>new DOMParser().parseFromString(xml,'application/xml'),xml=n=>new XMLSerializer().serializeToString(n);
const children=n=>Array.from(n.childNodes).filter(c=>c.nodeType===1),direct=(n,tag)=>children(n).find(c=>c.nodeName===tag);
function visible(n){let s='';function walk(c){if(['w:t','m:t'].includes(c.nodeName))s+=c.textContent;else if(c.nodeName==='w:tab')s+='\t';else if(['w:br','w:cr'].includes(c.nodeName))s+='\n';else for(let x=c.firstChild;x;x=x.nextSibling)walk(x);}walk(n);return s;}
function role(p,zip,doc){
 const pr=(direct(p,'w:pPr')||doc.createElementNS(W,'w:pPr')).cloneNode(true),numPr=direct(pr,'w:numPr');let level;
 if(numPr&&zip.file('word/numbering.xml')){
  const numbering=parse(zip.file('word/numbering.xml').asText()),id=numPr.getElementsByTagName('w:numId')[0]?.getAttribute('w:val'),ilvl=numPr.getElementsByTagName('w:ilvl')[0]?.getAttribute('w:val')||'0';
  const num=Array.from(numbering.getElementsByTagName('w:num')).find(n=>n.getAttribute('w:numId')===id),abstractId=num?.getElementsByTagName('w:abstractNumId')[0]?.getAttribute('w:val');
  const abstract=Array.from(numbering.getElementsByTagName('w:abstractNum')).find(n=>n.getAttribute('w:abstractNumId')===abstractId);
  level=abstract&&children(abstract).find(n=>n.nodeName==='w:lvl'&&n.getAttribute('w:ilvl')===ilvl);
  const listPr=level&&direct(level,'w:pPr');if(listPr)for(const n of children(listPr))if(!direct(pr,n.nodeName))pr.appendChild(n.cloneNode(true));
  pr.removeChild(numPr);
 }
 const rPr=doc.createElementNS(W,'w:rPr'),sources=[p.getElementsByTagName('w:r')[0]?.getElementsByTagName('w:rPr')[0],direct(pr,'w:rPr')].filter(Boolean);
 if(zip.file('word/styles.xml')){
  const styles=parse(zip.file('word/styles.xml').asText()),styleId=direct(pr,'w:pStyle')?.getAttribute('w:val');let id=styleId||'Normal';const seen=new Set();
  while(id&&!seen.has(id)){seen.add(id);const style=Array.from(styles.getElementsByTagName('w:style')).find(n=>n.getAttribute('w:styleId')===id);if(!style)break;if(direct(style,'w:rPr'))sources.push(direct(style,'w:rPr'));id=direct(style,'w:basedOn')?.getAttribute('w:val');}
  const defaults=styles.getElementsByTagName('w:rPrDefault')[0]?.getElementsByTagName('w:rPr')[0];if(defaults)sources.push(defaults);
 }
 for(const tag of ['w:rFonts','w:sz','w:szCs','w:color']){const value=sources.map(s=>direct(s,tag)).find(Boolean);if(value)rPr.appendChild(value.cloneNode(true));}
 return {pPr:pr,rPr,listText:level?.getElementsByTagName('w:lvlText')[0]?.getAttribute('w:val')||'%1.',format:level?.getElementsByTagName('w:numFmt')[0]?.getAttribute('w:val')};
}
function templateParts(buffer){
 const zip=new Zip(buffer),entry=zip.file('word/document.xml');if(!entry)throw Error('The administrator template is not a valid Word document.');
 const doc=parse(entry.asText()),body=doc.getElementsByTagName('w:body')[0];if(!body)throw Error('The administrator template has no document body.');
 const nodes=children(body),rm=nodes.findIndex(n=>n.nodeName==='w:p'&&/^(?:(?:section|part)\s*a[:.)\s-]*)?research\s+methodology\b/i.test(visible(n).trim()));
 const subject=nodes.findIndex((n,i)=>i>rm&&n.nodeName==='w:p'&&/^(?:subject[ -]specific|(?:section|part)\s*b[:.)\s-])/i.test(visible(n).trim()));
 const key=nodes.findIndex((n,i)=>i>subject&&/answer\s*key/i.test(visible(n))&&visible(n).trim().length<100);
 if(rm<0||subject<=rm||key<=subject)throw Error('The administrator template needs Research Methodology, Subject-Specific Questions and Answer Key headings in that order.');
 function slots(start,end){
  let first=nodes.findIndex((n,i)=>i>start&&i<end&&n.nodeName==='w:p'&&(/question\s+starts?\s+here/i.test(visible(n))||n.getElementsByTagName('w:numPr').length||/^\d+[.)]/.test(visible(n).trim())));
  if(first<0)first=start+1;
  const question=nodes[first]?.nodeName==='w:p'?nodes[first]:nodes[start],option=nodes.slice(first+1,end).find(n=>n.nodeName==='w:p'&&/option\s*a|^\(?a[.)]/i.test(visible(n).trim()))||question;
  return {start:first,end,question:role(question,zip,doc),option:role(option,zip,doc)};
 }
 const keyTable=nodes.slice(key+1).find(n=>n.nodeName==='w:tbl'&&/question\s*(?:no\.?|number)/i.test(visible(n))&&/correct\s*(?:option|answer)/i.test(visible(n)));
 const rows=keyTable&&children(keyTable).filter(n=>n.nodeName==='w:tr'),columns=rows?.[0]&&children(rows[0]).filter(n=>n.nodeName==='w:tc').length;
 if(!keyTable||!rows[1]||![2,4].includes(columns))throw Error('The administrator template needs a 2-column or 4-column Question No. / Correct Option answer-key table with a sample row.');
 return {zip,doc,body,nodes,rm,subject,key,keyTable,rows,columns,researchSlot:slots(rm,subject),subjectSlot:slots(subject,key)};
}
// Copy only the selected text interval while retaining its equations and drawings.
function segment(l,start,end){
 const clone=l.doc.cloneNode(true),runs=[];
 function visit(n){if(['w:r','m:r'].includes(n.nodeName))runs.push(n);else for(let c=n.firstChild;c;c=c.nextSibling)visit(c);}visit(clone.documentElement);
 for(let i=0;i<runs.length;i++){
  const node=runs[i],original=l.runs[i];if(!original)throw Error('Unsupported nested question content.');
  if(original.text.length?original.end<=start||original.start>=end:original.start<start||original.start>=end){node.parentNode.removeChild(node);continue;}
  let position=original.start;
  for(const child of Array.from(node.childNodes)){
   if(['w:rPr','m:rPr'].includes(child.nodeName))continue;
   const value=visible(child),stop=position+value.length;
   if(['w:t','m:t'].includes(child.nodeName)){child.textContent=value.slice(Math.max(0,start-position),Math.min(value.length,end-position));if(!child.textContent)node.removeChild(child);else child.setAttribute('xml:space','preserve');}
   else if(value.length?(stop<=start||position>=end):(position<start||position>=end))node.removeChild(child);
   position=stop;
  }
 }
 const paragraphs=children(clone.documentElement).filter(p=>visible(p).trim()||p.getElementsByTagName('w:drawing').length||p.getElementsByTagName('w:pict').length);
 // Source option separators must not turn into extra blank lines after the
 // template supplies one paragraph per option. Keep equations and images intact.
 for(const p of paragraphs){const leaves=[];function ink(n){if(['w:t','m:t','w:br','w:cr','w:tab','w:drawing','w:pict','w:sym'].includes(n.nodeName))leaves.push(n);else for(let c=n.firstChild;c;c=c.nextSibling)ink(c);}ink(p);
  for(const direction of [1,-1])for(const n of direction===1?leaves:[...leaves].reverse()){
   if(!n.parentNode)continue;
   if(['w:t','m:t'].includes(n.nodeName)){n.textContent=direction===1?n.textContent.trimStart():n.textContent.trimEnd();if(n.textContent)break;n.parentNode.removeChild(n);}
   else if(['w:br','w:cr','w:tab'].includes(n.nodeName))n.parentNode.removeChild(n);else break;
  }
 }
 return paragraphs;
}
function applyRole(p,style,doc){
 const old=direct(p,'w:pPr');if(old)p.removeChild(old);p.insertBefore(style.pPr.cloneNode(true),p.firstChild);
 for(const r of Array.from(p.getElementsByTagName('w:r'))){let pr=direct(r,'w:rPr');if(!pr){pr=doc.createElementNS(W,'w:rPr');r.insertBefore(pr,r.firstChild);}
  for(const tag of ['w:rStyle','w:rFonts','w:sz','w:szCs','w:color']){for(const n of children(pr).filter(n=>n.nodeName===tag))pr.removeChild(n);const value=direct(style.rPr,tag);if(value)pr.appendChild(value.cloneNode(true));}
 }
 return p;
}
function prefix(p,label,style,bold,doc){
 const r=doc.createElementNS(W,'w:r'),pr=style.rPr.cloneNode(true),b=doc.createElementNS(W,'w:b');b.setAttribute('w:val',bold?'1':'0');pr.appendChild(b);r.appendChild(pr);
 const t=doc.createElementNS(W,'w:t');t.setAttribute('xml:space','preserve');t.textContent=label;r.appendChild(t);r.appendChild(doc.createElementNS(W,'w:tab'));
 const pPr=direct(p,'w:pPr');p.insertBefore(r,pPr?pPr.nextSibling:p.firstChild);
}
function writeCell(cell,value,doc){
 const original=cell.getElementsByTagName('w:p')[0],p=original?original.cloneNode(true):doc.createElementNS(W,'w:p'),rPr=p.getElementsByTagName('w:rPr')[0]?.cloneNode(true);
 for(const n of Array.from(p.childNodes))if(n.nodeName!=='w:pPr')p.removeChild(n);
 const r=doc.createElementNS(W,'w:r');if(rPr)r.appendChild(rPr);const t=doc.createElementNS(W,'w:t');t.textContent=String(value);r.appendChild(t);p.appendChild(r);
 for(const n of Array.from(cell.childNodes))if(n.nodeName!=='w:tcPr')cell.removeChild(n);cell.appendChild(p);
}
function replaceText(p,pattern,value){
 const texts=Array.from(p.getElementsByTagName('w:t')),flat=texts.map(n=>n.textContent).join(''),matches=[...flat.matchAll(pattern)];
 for(const match of matches.reverse()){
  let position=0,inserted=false;const start=match.index,end=start+match[0].length;
  for(const t of texts){const s=t.textContent,next=position+s.length;
   if(next>start&&position<end){const left=s.slice(0,Math.max(0,start-position)),right=s.slice(Math.min(s.length,end-position));t.textContent=left+(inserted?'':value)+right;t.setAttribute('xml:space','preserve');inserted=true;}
   position=next;
  }
 }
}
function generateFromTemplate(selected,title,set,templateBuffer,{facultyName=''}={}){
 if(!templateBuffer)throw Error('Upload the administrator Set '+set+' Word template before generation.');
 const t=templateParts(templateBuffer),{zip,doc,body}=t;
 if(selected.some(q=>!q.answer||q.answer_error))throw Error('Every selected question needs an unambiguous source answer.');
 const relDoc=parse(zip.file('word/_rels/document.xml.rels')?.asText()||`<Relationships xmlns="${R}"/>`),types=parse(zip.file('[Content_Types].xml')?.asText()||'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
 const usedIds=new Set(Array.from(relDoc.getElementsByTagName('Relationship')).map(n=>n.getAttribute('Id')));let serial=0;
 let drawingId=Math.max(0,...Array.from(doc.getElementsByTagName('wp:docPr')).map(n=>Number(n.getAttribute('id'))||0));
 function importAssets(nodes,sourcePath){
  const source=new Zip(fs.readFileSync(sourcePath)),sourceDoc=parse(source.file('word/document.xml').asText());
  for(const attr of Array.from(sourceDoc.documentElement.attributes))if(attr.name.startsWith('xmlns:')&&!doc.documentElement.hasAttribute(attr.name))doc.documentElement.setAttribute(attr.name,attr.value);
  const sourceRels=source.file('word/_rels/document.xml.rels'),rels=sourceRels?Array.from(parse(sourceRels.asText()).getElementsByTagName('Relationship')):[],mapped=new Map();
  function walk(n){if(n.nodeType===1){
   if(n.nodeName==='wp:docPr')n.setAttribute('id',String(++drawingId));
   for(const attr of Array.from(n.attributes))if(['r:embed','r:id','r:link'].includes(attr.name)){
    const id=attr.value;if(!mapped.has(id)){
     const rel=rels.find(n=>n.getAttribute('Id')===id),target=rel?.getAttribute('Target');
     if(!rel||rel.getAttribute('TargetMode')==='External'||!target?.startsWith('media/'))throw Error('Source questions must use embedded inline images and Word equations.');
     const image=source.file('word/'+target);if(!image)throw Error('A source question image is missing.');
     let newId;do{newId='qpGenerated'+(++serial);}while(usedIds.has(newId));usedIds.add(newId);
     const dest='media/'+newId+'-'+target.split('/').pop();zip.file('word/'+dest,image.asUint8Array());
     const added=relDoc.createElementNS(R,'Relationship');added.setAttribute('Id',newId);added.setAttribute('Type',rel.getAttribute('Type'));added.setAttribute('Target',dest);relDoc.documentElement.appendChild(added);mapped.set(id,newId);
     const extension=dest.split('.').pop().toLowerCase();if(!Array.from(types.getElementsByTagName('Default')).some(n=>n.getAttribute('Extension').toLowerCase()===extension)){
      const sourceTypes=parse(source.file('[Content_Types].xml')?.asText()||'<Types/>'),type=Array.from(sourceTypes.getElementsByTagName('Default')).find(n=>n.getAttribute('Extension').toLowerCase()===extension)?.getAttribute('ContentType');
      if(!type)throw Error('The source image content type is missing.');const addedType=types.createElementNS(types.documentElement.namespaceURI,'Default');addedType.setAttribute('Extension',extension);addedType.setAttribute('ContentType',type);types.documentElement.appendChild(addedType);
     }
    }n.setAttribute(attr.name,mapped.get(id));
   }
  }for(let c=n.firstChild;c;c=c.nextSibling)walk(c);}nodes.forEach(walk);
 }
 function questionNodes(q,index,slot){
  const l=layout(markedQuestion(q.xml,q.answer,q.number));if(l.options.length!==4)throw Error('A selected question has ambiguous options.');
  const groups=[{start:0,end:l.options[0].start,style:slot.question,label:slot.question.listText.replace(/%\d/g,String(index+1)),bold:false},...l.options.map(o=>({start:o.body,end:o.end,style:slot.option,label:slot.option.listText.replace(/%\d/g,slot.option.format==='lowerLetter'?o.label.toLowerCase():o.label),bold:o.label===q.answer}))];
  const result=[];
  for(const group of groups){const nodes=segment(l,group.start,group.end);if(!nodes.length)throw Error('A selected question has an empty stem or option.');nodes.forEach(p=>applyRole(p,group.style,doc));prefix(nodes[0],group.label,group.style,group.bold,doc);result.push(...nodes);}
  result.forEach((p,i)=>{const pr=direct(p,'w:pPr');for(const tag of ['w:keepNext','w:keepLines'])for(const n of children(pr).filter(n=>n.nodeName===tag))pr.removeChild(n);pr.appendChild(doc.createElementNS(W,'w:keepLines'));if(i<result.length-1)pr.appendChild(doc.createElementNS(W,'w:keepNext'));});
  importAssets(result,q.source.path);return result;
 }
 const research=selected.filter(q=>q.section==='research'),subjects=selected.filter(q=>q.section==='subject');
 if(research.length!==25||![0,25].includes(subjects.length)||research.length+subjects.length!==selected.length)throw Error('A final paper needs 25 RM questions and either 25 subject questions or a Common RM paper with no subject section.');
 const ordered=[...research,...subjects];
 const rmNodes=research.flatMap((q,i)=>questionNodes(q,i,t.researchSlot)),subjectNodes=subjects.flatMap((q,i)=>questionNodes(q,research.length+i,t.subjectSlot));
 function replaceRange(start,end,replacement){const anchor=t.nodes[end];for(const p of replacement)body.insertBefore(p,anchor);for(const old of t.nodes.slice(start,end))if(old.parentNode===body)body.removeChild(old);}
 replaceRange(t.researchSlot.start,t.subject,rmNodes);replaceRange(subjects.length?t.subjectSlot.start:t.subject,t.key,subjectNodes);
 const keyPr=direct(t.nodes[t.key],'w:pPr')||doc.createElementNS(W,'w:pPr');if(!keyPr.parentNode)t.nodes[t.key].insertBefore(keyPr,t.nodes[t.key].firstChild);if(!direct(keyPr,'w:pageBreakBefore'))keyPr.appendChild(doc.createElementNS(W,'w:pageBreakBefore'));
 const half=t.columns===4?Math.ceil(ordered.length/2):ordered.length,prototype=t.rows[1];for(const row of t.rows.slice(1))t.keyTable.removeChild(row);
 for(let i=0;i<half;i++){const row=prototype.cloneNode(true),cells=children(row).filter(n=>n.nodeName==='w:tc'),values=t.columns===4?[i+1,ordered[i].answer,i+half<ordered.length?i+half+1:'',ordered[i+half]?.answer||'']:[i+1,ordered[i].answer];cells.forEach((c,j)=>writeCell(c,values[j],doc));t.keyTable.appendChild(row);}
 for(const p of Array.from(doc.getElementsByTagName('w:p'))){
  replaceText(p,/\{\{\s*department\s*\}\}|DEPARTMENT OF[ \t]*_{3,}/gi,'DEPARTMENT OF '+String(title).toUpperCase());
  replaceText(p,/Department(?: name)?[ \t]*:[ \t]*_{3,}/gi,'DEPARTMENT: '+String(title).toUpperCase());
  if(facultyName)replaceText(p,/\{\{\s*faculty\s*\}\}|(?:FACULTY|COLLEGE) OF[ \t]*_{3,}/gi,/^(?:faculty|college|school|institute)\b/i.test(facultyName)?facultyName.toUpperCase():'FACULTY OF '+facultyName.toUpperCase());
  if(facultyName)replaceText(p,/\{\{\s*institute\s*\}\}|(?:Institute|Institution)(?: name)?[ \t]*:[ \t]*_{3,}/gi,'INSTITUTE: '+facultyName.toUpperCase());
  replaceText(p,/\{\{\s*set\s*\}\}/gi,set);
  if(!subjects.length&&/Maximum Marks/i.test(visible(p)))for(const n of [...Array.from(p.getElementsByTagName('w:t')),...Array.from(p.getElementsByTagName('m:t'))])n.textContent=n.textContent.replace(/\b50\b/g,'25');
 }
 zip.file('word/document.xml',xml(doc));zip.file('word/_rels/document.xml.rels',xml(relDoc));zip.file('[Content_Types].xml',xml(types));
 return zip.generate({type:'nodebuffer'});
}
module.exports={generateFromTemplate,templateParts};
