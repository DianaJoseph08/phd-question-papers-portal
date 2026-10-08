const Zip = require('pizzip');
const {DOMParser, XMLSerializer} = require('@xmldom/xmldom');
const fs = require('fs');
const crypto = require('crypto');
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const parse = x => new DOMParser().parseFromString(x,'application/xml');
const serialize = n => new XMLSerializer().serializeToString(n);
function text(n) {let result='';function visit(node){if(node.nodeName==='w:t')result+=node.textContent;else if(['w:br','w:cr'].includes(node.nodeName))result+='\n';else if(node.nodeName==='w:tab')result+='\t';else for(let child=node.firstChild;child;child=child.nextSibling)visit(child);}visit(n);return result;}
const isAnswerKeyHeading=t=>t.length<100&&(/answer\s*key\s*$/i.test(t)||/^answer\s*key\b/i.test(t));
function inspect(buffer) {
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
 function format(p){
  const id=p.getElementsByTagName('w:numId')[0]?.getAttribute('w:val');
  const level=p.getElementsByTagName('w:ilvl')[0]?.getAttribute('w:val')||'0';
  if(!numberDoc||!id)return null;
  const num=Array.from(numberDoc.getElementsByTagName('w:num')).find(n=>n.getAttribute('w:numId')===id);
  const aid=num?.getElementsByTagName('w:abstractNumId')[0]?.getAttribute('w:val');
  const abstract=Array.from(numberDoc.getElementsByTagName('w:abstractNum')).find(n=>n.getAttribute('w:abstractNumId')===aid);
  const lvl=abstract&&Array.from(abstract.getElementsByTagName('w:lvl')).find(n=>n.getAttribute('w:ilvl')===level);
  return lvl?.getElementsByTagName('w:numFmt')[0]?.getAttribute('w:val');
 }
 const heading=t=>{
  if(/^(?:(?:part|section)\s*[a1][.:) –—-]*\s*)?research\s+methodology\b/i.test(t))return 'research';
  if(/^(?:(?:part|section)\s*[b2][.:) –—-]*\s*)?subject[ -]specific(?:\s+(?:questions|core\s+topics))?(?=\s*(?:$|\(|[0-9]))/i.test(t))return 'subject';
  // Department-specific Section B headings (for example “Section B: Mathematics”).
  // Once Section A is Research Methodology, the paired Section B is the subject block.
  const paired=t.match(/^(?:part|section)\s*[b2][.:) –—-]+(.+)$/i);
  if(paired&&!/research\s+methodology/i.test(paired[1]))return 'subject';
  if(/^mathematics(?:\s+\(|\s+-|\s*$)/i.test(t))return 'subject';
  return null;
 };
 const hasSections=paragraphs.some(p=>!inSummary(p)&&!p.getElementsByTagName('w:numPr').length&&heading(text(p).trim()));
 let section=null,pending=[],questions=[],letter=0,started=false,number=null;
 function flush(){if(!pending.length)return;const combined=pending.map(x=>text(parse(x))).join('\n');questions.push({section:section||'unclassified',number,xml:pending.join(''),text:combined,hash:crypto.createHash('sha256').update(combined.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')).digest('hex')});pending=[];letter=0;}
 for(const p of paragraphs){
  if(inSummary(p))continue;
  // Nested textbox paragraphs are visited separately, never counted twice.
  const t=text(p).trim(),nextSection=p.getElementsByTagName('w:numPr').length?null:heading(t);
  if((started||section)&&isAnswerKeyHeading(t)){flush();break;}
  if(p.getElementsByTagName('w:p').length)continue;
  if(nextSection){flush();section=nextSection;started=false;continue;}
  if(hasSections&&!section)continue;
  if(/^\(?25\s*(?:[×x]|1\s*=)/i.test(t))continue;
  if(!t&&!p.getElementsByTagName('w:drawing').length&&!p.getElementsByTagName('m:oMath').length&&!p.getElementsByTagName('w:pict').length)continue;
  const manual=t.match(/^(?:Q(?:uestion)?\s*\.?\s*)?(\d{1,3})\s*[.)]\s*(?!\d)/i)||t.match(/^(\d{1,3})$/);
  const automatic=['decimal','decimalZero'].includes(format(p))&&(p.getElementsByTagName('w:ilvl')[0]?.getAttribute('w:val')||'0')==='0';
  const questionLike=/[?？]|\b[A-D][.)]\s|^(which|what|how|why|define|explain|identify|describe)\b/i.test(t);
  const boundary=(manual||automatic)&&(section||started||questionLike);
  if(boundary){flush();number=manual?Number(manual[1]):null;started=true;}
  if(!started)continue;
  if(!t&&!p.getElementsByTagName('w:drawing').length&&!p.getElementsByTagName('m:oMath').length&&!p.getElementsByTagName('w:pict').length)continue;
  let xml=serialize(p);
  if(['lowerLetter','upperLetter'].includes(format(p))&&pending.length&&!/^\(?[A-Da-d][.)]/.test(t)){
   const label=String.fromCharCode(65+letter++)+') ';
   const cloned=p.cloneNode(true),r=doc.createElementNS(ns,'w:r'),tNode=doc.createElementNS(ns,'w:t');
   tNode.setAttribute('xml:space','preserve');tNode.appendChild(doc.createTextNode(label));r.appendChild(tNode);
   const pPr=cloned.getElementsByTagName('w:pPr')[0];cloned.insertBefore(r,pPr?pPr.nextSibling:cloned.firstChild);xml=serialize(cloned);
  }
  pending.push(xml);
 }
 flush();
 const counts={research:questions.filter(q=>q.section==='research').length,subject:questions.filter(q=>q.section==='subject').length};
 const unclassified=questions.filter(q=>q.section==='unclassified').length;if(unclassified)counts.unclassified=unclassified;
 const placeholders=questions.some(q=>/\b(?:the\s+)?question\s+starts?\s+here\b/i.test(q.text));
 return {questions,counts,valid:counts.research===25&&counts.subject===25&&!unclassified&&!placeholders,method:'question-numbering'};
}

function choose(pools, single=false, finalSet='A',common=false) {
 const selected=[],seen=new Set();
 const shuffle=a=>a.map(v=>({v,n:crypto.randomInt(2147483647)})).sort((a,b)=>a.n-b.n).map(x=>x.v);
 for(const section of (common?['research']:['research','subject'])) {
  for(let campus=1;campus<=2;campus++) {
   const need=single?(pools.some(p=>p.campus===campus)?25:0):(common?(campus===(finalSet==='A'?1:2)?13:12):(section==='research'?(campus===1?13:12):(campus===1?12:13)));
   const campusPools=pools.filter(p=>p.campus===campus);
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
function paragraph(s,bold=false) {return `<w:p><w:r><w:rPr>${bold?'<w:b/>':''}<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${esc(s)}</w:t></w:r></w:p>`;}
function generate(selected,title,set) {
 const out=new Zip(); let body=paragraph('SRMIST • PhD Entrance Examination',true)+paragraph(`${title} • January 2027 • Set ${set}`,true)+paragraph('Name: ____________________   Application No.: ____________________')+paragraph(`Duration: 2 hours | ${selected.length} questions × 1 mark | No negative marking`)+paragraph('Choose one correct option per question. Mark answers on the OMR sheet. Calculators and reference materials are prohibited.');
 const rels=[]; let counter=0,lastSection=''; const namespaceAttrs=new Map();
 selected.forEach((q,index)=>{
  if(q.section!==lastSection){body+=paragraph(q.section==='research'?'Research Methodology (25 marks)':'Subject-Specific Questions (25 marks)',true);lastSection=q.section;}
  const source=new Zip(fs.readFileSync(q.source.path));
  const sourceDoc=parse(source.file('word/document.xml').asText());
  for(const a of Array.from(sourceDoc.documentElement.attributes)) if(a.name.startsWith('xmlns:')) namespaceAttrs.set(a.name,a.value);
  let xml=q.xml.replace(/<w:numPr[\s\S]*?<\/w:numPr>/g,'').replace(/<w:b(?:\s[^>]*)?\s*\/>/g,'').replace(/<w:bCs(?:\s[^>]*)?\s*\/>/g,'').replace(/<w:b(?:\s[^>]*)?>[\s\S]*?<\/w:b>/g,'').replace(/<w:pStyle[^>]*\/>/g,'').replace(/<w:rStyle[^>]*\/>/g,'').replace(/(<wp:docPr\b[^>]*\bid=")[^"]+("[^>]*>)/g,(_,a,b)=>a+(++counter)+b);
  const sourceRels=source.file('word/_rels/document.xml.rels');
  const docRels=sourceRels?Array.from(parse(sourceRels.asText()).getElementsByTagName('Relationship')):[];
  xml=xml.replace(/\b(r:embed|r:id|r:link)="([^"]+)"/g,(match,attr,id)=>{
   const rel=docRels.find(r=>r.getAttribute('Id')===id);if(!rel)throw Error('A document relationship is missing.');
   if(rel.getAttribute('TargetMode')==='External')throw Error('Linked external content must be embedded before generation.');
   const target=rel.getAttribute('Target');if(!target.startsWith('media/'))throw Error('Unsupported embedded content; use inline images and Word equations.');
   const entry=source.file('word/'+target);if(!entry)throw Error('Embedded image is missing.');
   const newId='rId'+(++counter), dest='media/'+counter+'-'+target.split('/').pop();out.file('word/'+dest,entry.asUint8Array());
   rels.push(`<Relationship Id="${newId}" Type="${esc(rel.getAttribute('Type'))}" Target="${esc(dest)}"/>`);return `${attr}="${newId}"`;
  });
  body+=paragraph(`Question ${index+1}`,true)+xml;
 });
 body+='<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr>';
 namespaceAttrs.set('xmlns:w',ns);namespaceAttrs.set('xmlns:r','http://schemas.openxmlformats.org/officeDocument/2006/relationships');
 out.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8"?><w:document ${Array.from(namespaceAttrs).map(([k,v])=>`${k}="${esc(v)}"`).join(' ')}><w:body>${body}</w:body></w:document>`);
 out.file('word/_rels/document.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
 out.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 const types={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',emf:'image/x-emf',wmf:'image/x-wmf',svg:'image/svg+xml',tif:'image/tiff',tiff:'image/tiff',bmp:'image/bmp'};
 out.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(types).map(([ext,type])=>`<Default Extension="${ext}" ContentType="${type}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
 return out.generate({type:'nodebuffer'});
}
module.exports={inspect,choose,generate,text,isAnswerKeyHeading};
