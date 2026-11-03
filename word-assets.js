const Zip=require('pizzip'),fs=require('fs'),path=require('path');
const {DOMParser}=require('@xmldom/xmldom');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/package/2006/relationships';
const parse=xml=>new DOMParser().parseFromString(xml,'application/xml');
const children=node=>Array.from(node.childNodes).filter(n=>n.nodeType===1);
function packageTarget(target){
 const normalized=String(target||'').replace(/\\/g,'/');
 if(!normalized||/^[a-z][a-z\d+.-]*:/i.test(normalized)||normalized.startsWith('//')||normalized.includes('\0'))throw Error('The image does not have a valid embedded document path.');
 const resolved=path.posix.normalize(normalized.startsWith('/')?normalized.slice(1):path.posix.join('word',normalized));
 if(resolved==='..'||resolved.startsWith('../'))throw Error('The image path points outside the Word document package.');
 return resolved;
}
function createAssetImporter({zip,doc,relDoc,types}){
 const usedIds=new Set(Array.from(relDoc.getElementsByTagName('Relationship')).map(n=>n.getAttribute('Id'))),sources=new Map(),imported=new Map();let serial=0,vmlSerial=0;
 let drawingId=Math.max(0,...Array.from(doc.getElementsByTagName('wp:docPr')).map(n=>Number(n.getAttribute('id'))||0));
 const vmlIds=new Set([...Array.from(doc.getElementsByTagName('v:shape')),...Array.from(doc.getElementsByTagName('v:shapetype'))].map(n=>n.getAttribute('id')));
 function vmlId(prefix){let id;do{id=prefix+(++vmlSerial);}while(vmlIds.has(id));vmlIds.add(id);return id;}
 function sourceFile(file){
  if(sources.has(file))return sources.get(file);
  const archive=new Zip(fs.readFileSync(file)),document=parse(archive.file('word/document.xml').asText());
  const relationships=new Map(Array.from(parse(archive.file('word/_rels/document.xml.rels')?.asText()||'<Relationships/>').getElementsByTagName('Relationship')).map(n=>[n.getAttribute('Id'),n]));
  const contentTypes=parse(archive.file('[Content_Types].xml')?.asText()||'<Types/>');
  const shapes=new Map(Array.from(document.getElementsByTagName('v:shapetype')).map(n=>[n.getAttribute('id'),n]));
  const source={archive,document,relationships,contentTypes,shapes};sources.set(file,source);return source;
 }
 function embeddedImage(source,id){
  const relationship=source.relationships.get(id);
  if(!relationship)throw Error('An image relationship is missing from the source Word document.');
  if(!relationship.getAttribute('Type').endsWith('/image'))throw Error('This object has no supported embedded image preview. In Word, paste its visible content as a picture or convert it to a Word equation, then reupload.');
  if(relationship.getAttribute('TargetMode')==='External')throw Error('This question contains a linked image. In Word, embed the image using Insert > Pictures, then save and reupload the source paper.');
  const target=packageTarget(relationship.getAttribute('Target'));let resolved=target,image=source.archive.file(target);
  if(!image){try{resolved=packageTarget(decodeURIComponent(relationship.getAttribute('Target')));image=source.archive.file(resolved);}catch{}}
  if(!image)throw Error('An embedded image is missing from the source Word file. Insert the image again, save and reupload the paper.');
  const extension=path.posix.extname(resolved).slice(1).toLowerCase();
  const override=Array.from(source.contentTypes.getElementsByTagName('Override')).find(n=>{const part=n.getAttribute('PartName').replace(/^\//,'');try{return part===resolved||decodeURIComponent(part)===resolved;}catch{return part===resolved;}});
  const type=override?.getAttribute('ContentType')||Array.from(source.contentTypes.getElementsByTagName('Default')).find(n=>n.getAttribute('Extension').toLowerCase()===extension)?.getAttribute('ContentType');
  if(!type?.startsWith('image/'))throw Error('The embedded image has no valid image content type. Save the image as PNG or JPEG and insert it again in Word.');
  return {relationship,resolved,image,type,extension};
 }
 return function importAssets(nodes,file){
  const source=sourceFile(file);
  for(const attr of Array.from(source.document.documentElement.attributes))if(attr.name.startsWith('xmlns:')&&!doc.documentElement.hasAttribute(attr.name))doc.documentElement.setAttribute(attr.name,attr.value);
  function previewRefs(node){return [...Array.from(node.getElementsByTagName('v:imagedata')).map(n=>n.getAttribute('r:id')), ...Array.from(node.getElementsByTagName('a:blip')).map(n=>n.getAttribute('r:embed'))].filter(Boolean);}
  function prepare(node){
   if(node.nodeName==='a:blip'&&node.hasAttribute('r:embed')&&node.hasAttribute('r:link')){embeddedImage(source,node.getAttribute('r:embed'));node.removeAttribute('r:link');}
   // Older Equation Editor / MathType objects include an embedded picture of the
   // equation. Keep that exact visible picture, not the executable OLE object.
   if(node.nodeName==='w:object'&&node.getElementsByTagName('o:OLEObject').length){
    const objects=Array.from(node.getElementsByTagName('o:OLEObject')),refs=previewRefs(node);
    if(!refs.length||objects.some(n=>n.getAttribute('DrawAspect')==='Icon'))throw Error('This embedded equation/object has no visible picture preview. In Word, convert it to a Word equation or paste its visible content as a picture, then reupload.');
    refs.forEach(id=>embeddedImage(source,id));
    const pict=node.ownerDocument.createElementNS(W,'w:pict');
    for(const attr of Array.from(node.attributes))if(!['w:dxaOrig','w:dyaOrig'].includes(attr.name))pict.setAttribute(attr.name,attr.value);
    for(const child of children(node))if(child.nodeName!=='o:OLEObject')pict.appendChild(child.cloneNode(true));
    for(const ole of Array.from(pict.getElementsByTagName('o:OLEObject')))ole.parentNode.removeChild(ole);
    for(const shape of Array.from(pict.getElementsByTagName('v:shape')))shape.removeAttribute('o:ole');
    node.parentNode.replaceChild(pict,node);node=pict;
   }
   // Some Office charts offer an embedded image for applications that cannot
   // display the editable chart. That image is sufficient for the exam paper.
   if(node.nodeName==='mc:AlternateContent'){
    const choice=children(node).find(n=>n.nodeName==='mc:Choice'),fallback=children(node).find(n=>n.nodeName==='mc:Fallback');
    if(choice?.getElementsByTagName('c:chart').length&&fallback&&previewRefs(fallback).length){
     previewRefs(fallback).forEach(id=>embeddedImage(source,id));
     for(const child of children(fallback)){const copy=child.cloneNode(true);node.parentNode.insertBefore(copy,node);prepare(copy);}node.parentNode.removeChild(node);return;
    }
   }
   for(const child of children(node))prepare(child);
  }
  nodes.forEach(prepare);
  // VML previews sometimes refer to a shape definition stored in another
  // question. Import it and use unique IDs when mixing papers and campuses.
  const definitions=new Map(),shapes=[];
  function vml(node){if(node.nodeName==='v:shapetype')definitions.set(node.getAttribute('id'),node);if(node.nodeName==='v:shape')shapes.push(node);for(const child of children(node))vml(child);}
  nodes.forEach(vml);const renamed=new Map();
  for(const shape of shapes){
   const old=shape.getAttribute('type');
   if(old.startsWith('#')){
    const id=old.slice(1);let definition=definitions.get(id);
    if(!definition){const original=source.shapes.get(id);if(!original)throw Error('The picture preview is missing its Word shape definition. Reinsert the equation/picture in Word and reupload.');definition=original.cloneNode(true);shape.parentNode.insertBefore(definition,shape);definitions.set(id,definition);}
    if(!renamed.has(id)){const fresh=vmlId('_qpType');definition.setAttribute('id',fresh);renamed.set(id,fresh);}shape.setAttribute('type','#'+renamed.get(id));
   }
   shape.setAttribute('id',vmlId('_qpShape'));
  }
  function walk(node){
   if(node.nodeType===1){
    if(node.nodeName==='wp:docPr')node.setAttribute('id',String(++drawingId));
    for(const attr of Array.from(node.attributes))if(['r:embed','r:id','r:link'].includes(attr.name)){
     const id=attr.value,cache=file+'|'+id;let newId=imported.get(cache);
     if(!newId){
      const rel=source.relationships.get(id);if(!rel)throw Error('A source image/object relationship is missing.');
      const type=rel.getAttribute('Type');let target,mode=rel.getAttribute('TargetMode');
      if(type.endsWith('/hyperlink')){
       target=rel.getAttribute('Target');let protocol;try{protocol=new URL(target).protocol;}catch{}
       if(mode!=='External'||!['http:','https:','mailto:'].includes(protocol))throw Error('This question has an unsupported hyperlink. Use a normal web/email link or plain text in the source paper.');
       do{newId='qpGenerated'+(++serial);}while(usedIds.has(newId));
      }else{
       const image=embeddedImage(source,id),base=path.posix.basename(image.resolved);
       do{newId='qpGenerated'+(++serial);target='media/'+newId+'-'+base;}while(usedIds.has(newId)||zip.file('word/'+target));
       zip.file('word/'+target,image.image.asUint8Array());mode='';
       const defaults=Array.from(types.getElementsByTagName('Default')),existing=defaults.find(n=>n.getAttribute('Extension').toLowerCase()===image.extension);
       const contentType=types.createElementNS(types.documentElement.namespaceURI,existing?'Override':'Default');
       if(!existing){contentType.setAttribute('Extension',image.extension);contentType.setAttribute('ContentType',image.type);types.documentElement.appendChild(contentType);}
       else if(existing.getAttribute('ContentType')!==image.type){contentType.setAttribute('PartName','/word/'+target);contentType.setAttribute('ContentType',image.type);types.documentElement.appendChild(contentType);}
      }
      usedIds.add(newId);const added=relDoc.createElementNS(R,'Relationship');added.setAttribute('Id',newId);added.setAttribute('Type',type);added.setAttribute('Target',type.endsWith('/image')?encodeURI(target):target);if(mode)added.setAttribute('TargetMode',mode);relDoc.documentElement.appendChild(added);imported.set(cache,newId);
     }
     node.setAttribute(attr.name,newId);
    }
   }
   for(const child of children(node))walk(child);
  }
  nodes.forEach(walk);
 };
}
module.exports={createAssetImporter,packageTarget};
