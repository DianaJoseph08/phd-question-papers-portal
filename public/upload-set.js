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
function wordFileError(name){
 if(/\.docx$/i.test(String(name)))return null;
 return /\.doc$/i.test(String(name))
  ?'This is an older Word .doc file. Open it in Microsoft Word and choose File > Save As > Word Document (.docx), then upload the saved copy. Renaming .doc to .docx does not convert the file.'
  :'Choose a Word Document (.docx). PDF, image and other file types cannot be uploaded as question papers. Download the Word template and save the completed paper as .docx.';
}
if(typeof module!=='undefined')module.exports={setFromFilename,selectFileSet,wordFileError};
