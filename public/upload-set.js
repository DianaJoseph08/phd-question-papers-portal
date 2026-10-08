// Shared by the upload form and server so filename checks agree.
function setFromFilename(name){
 const stem=String(name||'').replace(/\.docx?$/i,'');
 const sets=new Set(Array.from(stem.matchAll(/(?:^|[\s_.()–—-])set[\s_.()–—-]*([ab])(?=$|[\s_.()–—-])/gi),m=>m[1].toUpperCase()));
 return sets.size===1?[...sets][0]:null;
}
function selectFileSet(form){
 const file=form.elements.namedItem('file').files?.[0];
 const detected=setFromFilename(file?.name);
 if(detected)form.elements.namedItem('set_name').value=detected;
 return detected;
}
if(typeof module!=='undefined')module.exports={setFromFilename,selectFileSet};
