const {layout}=require('./answers');
const escape=value=>value.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const complete=value=>{const labels=new Set(layout('<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>').options.map(o=>o.label));return ['A','B','C','D'].every(label=>labels.has(label));};
const numberedStart=value=>value.match(/^[ \t]*(?:Q(?:uestion)?[ \t]*\.?[ \t]*)?(\d{1,3})(?:[ \t]*[.)](?!\d)[ \t]*|[ \t]+(?=[\p{L}("'‘’“”]))/iu);

// Copy a visible-text interval, preserving formatting, equations and pictures.
// The original document bytes are never changed.
function sliceParagraph(paragraph,start,end){
 let position=0;
 function copy(node){
  if(node.nodeType!==1)return {node:node.cloneNode(true),selected:false};
  if(/Pr$/.test(node.nodeName))return {node:node.cloneNode(true),selected:false};
  if(['w:t','m:t'].includes(node.nodeName)){
   const value=node.textContent,s=position;position+=value.length;
   const selected=value.slice(Math.max(0,start-s),Math.min(value.length,end-s));
   if(!selected||s>=end||position<=start)return {node:null,selected:false};
   const clone=node.cloneNode(false);clone.textContent=selected;clone.setAttribute('xml:space','preserve');return {node:clone,selected:true};
  }
  if(['w:br','w:cr','w:tab'].includes(node.nodeName)){const selected=position>=start&&position<end;position++;return {node:selected?node.cloneNode(true):null,selected};}
  const elements=Array.from(node.childNodes).filter(n=>n.nodeType===1);
  if(!elements.length){const selected=position>=start&&position<=end;return {node:selected?node.cloneNode(true):null,selected};}
  const clone=node.cloneNode(false);let selected=false;
  for(const child of Array.from(node.childNodes)){const result=copy(child);if(result.node)clone.appendChild(result.node);selected||=result.selected;}
  return {node:selected?clone:null,selected};
 }
 return copy(paragraph).node;
}

function splitQuestionParagraphs(doc,{text,heading,isAnswerKeyHeading,inSummary}){
 const paragraphs=Array.from(doc.getElementsByTagName('w:p'));
 const hasHeadings=paragraphs.some(p=>!inSummary(p)&&!p.getElementsByTagName('w:numPr').length&&heading(text(p).trim()));
 let active=!hasHeadings;
 for(const [index,p]of paragraphs.entries()){
  if(inSummary(p)||p.getElementsByTagName('w:p').length)continue;
  const value=text(p),section=!p.getElementsByTagName('w:numPr').length&&heading(value.trim());
  if(section){active=true;continue;}
  if(active&&isAnswerKeyHeading(value.trim()))break;
  if(!active||p.getElementsByTagName('w:numPr').length)continue;
  const first=numberedStart(value);if(!first)continue;
  const pieces=[];let start=0,number=Number(first[1]);
  for(const candidate of value.matchAll(/\n([ \t]*(?:Q(?:uestion)?[ \t]*\.?[ \t]*)?(\d{1,3})[ \t]*[.)](?!\d)[ \t]*)/gi)){
   if(Number(candidate[2])!==number+1||!complete(value.slice(start,candidate.index)))continue;
   const next=candidate.index+1,stem=value.slice(next).split('\n')[0];let confirmed=/[?？]|\b(?:which|what|how|why|define|explain|identify|describe)\b/i.test(stem)||complete(value.slice(next));
   // A new question may put its four options in following paragraphs.
   let ahead=value.slice(next);
   for(let i=index+1;!confirmed&&i<Math.min(paragraphs.length,index+13);i++){
    const nextText=text(paragraphs[i]).trim();if(heading(nextText)||isAnswerKeyHeading(nextText)||numberedStart(nextText))break;
    ahead+='\n'+nextText;if(complete(ahead))confirmed=true;
   }
   if(!confirmed)continue;
   pieces.push({start,end:candidate.index});start=next;number=Number(candidate[2]);
  }
  if(!pieces.length)continue;pieces.push({start,end:value.length});
  for(const [i,range]of pieces.entries()){
   const clone=sliceParagraph(p,range.start,range.end);if(!clone)throw Error('A numbered question could not be separated from its Word paragraph.');
   if(i){clone.removeAttribute('w14:paraId');clone.removeAttribute('w14:textId');}
   p.parentNode.insertBefore(clone,p);
  }
  p.parentNode.removeChild(p);
 }
}
module.exports={splitQuestionParagraphs};
