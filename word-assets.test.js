const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),Zip=require('pizzip');
const {DOMParser}=require('@xmldom/xmldom');
const {inspect,generate}=require('./papers'),{templateFixture}=require('./test-template'),{examCopy}=require('./exam-copy'),{packageTarget}=require('./word-assets');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
function source(t,{ole=false,preview=true,external=false,hyperlink=false,absolute=false,encoded=false,override=false,chart=false,dual=false,pictureOptions=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qp-word-assets-'));t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 const imageName=encoded?'image 1.emf':'image1.emf';
 const z=new Zip(),rels=[`<Relationship Id="picture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${external?'https://example.test/image.emf':absolute?'/word/media/'+imageName:encoded?'media/image%201.emf':'media/'+imageName}"${external?' TargetMode="External"':''}/>`,
  '<Relationship Id="object" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/>',
  '<Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test/reference" TargetMode="External"/>',
  '<Relationship Id="chart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/>',
  '<Relationship Id="linkedPicture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.test/image.emf" TargetMode="External"/>'];
 let body='';for(const section of ['Research Methodology','Subject-Specific Questions']){
  body+=p(section);for(let i=1;i<=25;i++){
   body+=p(`${i}. Which result applies to sample ${i} in ${section}?`);
   if(pictureOptions){for(const label of ['reaction','A','B','C','D'])body+=`<w:p><w:pPr><w:spacing w:after="180"/></w:pPr><w:r><w:drawing><wp:anchor><wp:positionV relativeFrom="paragraph"><wp:posOffset>167005</wp:posOffset></wp:positionV><wp:extent cx="2000000" cy="500000"/><wp:docPr id="1" name="${label}"/><a:graphic><a:graphicData><a:blip r:embed="picture"/></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`+(label==='reaction'?'':p(label+'. '));}
   else if(ole)body+=`<w:p><w:r><w:object><v:shape id="original${i}" type="#shape75" style="width:94pt;height:40pt" o:ole="">${preview?'<v:imagedata r:id="picture"/>':''}</v:shape><o:OLEObject Type="Embed" ProgID="Equation.DSMT4" DrawAspect="Content" ShapeID="original${i}" r:id="object"/></w:object></w:r></w:p>`;
   else if(chart)body+='<w:p><w:r><mc:AlternateContent><mc:Choice Requires="c"><w:drawing><c:chart r:id="chart"/></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape id="chartPicture" style="width:94pt;height:40pt"><v:imagedata r:id="picture"/></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>';
   else body+=`<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Question image"/><a:graphic><a:graphicData><a:blip r:embed="picture"${dual?' r:link="linkedPicture"':''}/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
   if(hyperlink)body+='<w:p><w:hyperlink r:id="link"><w:r><w:t>Read the reference article</w:t></w:r></w:hyperlink></w:p>';
   if(!pictureOptions)body+=p('A) alpha B) beta C) gamma D) delta');
  }
 }
 body+=p('Answer Key');for(let i=1;i<=50;i++)body+=p(i+' B');
 // The shape definition can live outside the selected question's XML.
 body+='<w:p><w:r><w:pict><v:shapetype id="shape75" coordsize="21600,21600" o:spt="75"/></w:pict></w:r></w:p>';
 z.file('word/document.xml',`<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body}</w:body></w:document>`);
 z.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels.join('')+'</Relationships>');
 z.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+(override?`<Override PartName="/word/media/${encodeURI(imageName)}" ContentType="image/x-emf"/>`:'<Default Extension="emf" ContentType="image/x-emf"/>')+'</Types>');
 z.file('word/media/'+imageName,Buffer.from('exact cached equation preview'));z.file('word/embeddings/oleObject1.bin','active equation object');
 const file=path.join(directory,'physics.docx'),buffer=z.generate({type:'nodebuffer'});fs.writeFileSync(file,buffer);
 return {buffer,file,selected:inspect(buffer).questions.map(q=>({...q,source:{path:file,original_name:'Physics_Set_B.docx',set_name:'B',campus:2,campus_name:'Trichy',department_name:'Physics'}}))};
}
test('MathType/Equation Editor previews are retained even in standalone equation paragraphs',t=>{
 const s=source(t,{ole:true}),original=Buffer.from(s.buffer);assert.equal(s.selected.length,50);assert.ok(s.selected.every(q=>q.xml.includes('w:object')));
 const output=generate(s.selected,'Physics','B',templateFixture('B')),z=new Zip(output),doc=new DOMParser().parseFromString(z.file('word/document.xml').asText(),'application/xml');
 assert.equal(doc.getElementsByTagName('o:OLEObject').length,0);assert.equal(doc.getElementsByTagName('v:imagedata').length,50);assert.equal(doc.getElementsByTagName('v:shapetype').length,50);
 const ids=Array.from(doc.getElementsByTagName('v:shape')).map(n=>n.getAttribute('id'));assert.equal(new Set(ids).size,50);
 const types=new Set(Array.from(doc.getElementsByTagName('v:shapetype')).map(n=>n.getAttribute('id')));for(const shape of Array.from(doc.getElementsByTagName('v:shape'))){assert.ok(types.has(shape.getAttribute('type').slice(1)));assert.equal(shape.getAttribute('style'),'width:94pt;height:40pt');assert.equal(shape.hasAttribute('o:ole'),false);}
 const rels=new DOMParser().parseFromString(z.file('word/_rels/document.xml.rels').asText(),'application/xml');const images=Array.from(rels.getElementsByTagName('Relationship')).filter(n=>n.getAttribute('Type').endsWith('/image'));assert.equal(images.length,1);assert.equal(z.file('word/'+images[0].getAttribute('Target')).asText(),'exact cached equation preview');
 assert.ok(!Object.keys(z.files).some(n=>n.startsWith('word/embeddings/')));assert.deepEqual(inspect(output).counts,{research:25,subject:25});assert.ok(inspect(output).questions.every(q=>q.answer==='B'));
 const exam=examCopy(output);assert.equal(new DOMParser().parseFromString(new Zip(exam).file('word/document.xml').asText(),'application/xml').getElementsByTagName('v:imagedata').length,50);assert.deepEqual(s.buffer,original);
});
test('embedded absolute paths, encoded filenames and content-type overrides are supported',t=>{
 for(const options of [{absolute:true},{encoded:true,override:true}]){
  const s=source(t,options),z=new Zip(generate(s.selected,'Physics','B',templateFixture('B')));assert.equal(inspect(z.generate({type:'nodebuffer'})).questions.length,50);assert.equal(z.file('[Content_Types].xml').asText().includes('image/x-emf'),true);
 }
 assert.equal(packageTarget('/word/media/image.emf'),'word/media/image.emf');assert.throws(()=>packageTarget('../../outside.emf'),/outside/);
});
test('ordinary question hyperlinks do not cause image/object generation failures',t=>{
 const s=source(t,{hyperlink:true}),z=new Zip(generate(s.selected,'Physics','B',templateFixture('B'))),rels=new DOMParser().parseFromString(z.file('word/_rels/document.xml.rels').asText(),'application/xml');
 assert.ok(z.file('word/document.xml').asText().includes('Read the reference article'));assert.ok(Array.from(rels.getElementsByTagName('Relationship')).some(n=>n.getAttribute('Target')==='https://example.test/reference'&&n.getAttribute('TargetMode')==='External'));
});
test('Office charts with a stored fallback picture use the original picture',t=>{
 const s=source(t,{chart:true}),z=new Zip(generate(s.selected,'Physics','B',templateFixture('B'))),d=new DOMParser().parseFromString(z.file('word/document.xml').asText(),'application/xml');
 assert.equal(d.getElementsByTagName('c:chart').length,0);assert.equal(d.getElementsByTagName('v:imagedata').length,50);assert.ok(!Object.keys(z.files).some(n=>n.startsWith('word/charts/')));
});
test('unrecoverable objects name the exact uploaded file, campus, source set and question',t=>{
 const s=source(t,{ole:true,preview:false});s.selected[0].source_number=7;
 assert.throws(()=>generate(s.selected,'Physics','A',templateFixture('A')),e=>{const issue=e.details.generation_issues[0];assert.equal(e.status,422);assert.equal(issue.filename,'Physics_Set_B.docx');assert.equal(issue.campus,'Trichy');assert.equal(issue.department,'Physics');assert.equal(issue.set,'B');assert.equal(issue.question,7);assert.match(issue.remark,/visible picture preview/);return true;});
});
test('external-only images remain blocked with an embedding instruction and are never fetched',t=>{
 const s=source(t,{external:true});assert.throws(()=>generate(s.selected,'Physics','A',templateFixture('A')),e=>e.status===422&&/linked image/.test(e.details.generation_issues[0].remark));
});
test('images with both a cached copy and an external link use only the embedded copy',t=>{
 const s=source(t,{dual:true}),z=new Zip(generate(s.selected,'Physics','B',templateFixture('B')));
 assert.ok(!z.file('word/document.xml').asText().includes('r:link='));assert.ok(!z.file('word/_rels/document.xml.rels').asText().includes('example.test'));
});
test('floating reaction diagrams and four image-only choices retain their source order and anchors',t=>{
 const s=source(t,{pictureOptions:true}),output=generate(s.selected,'Chemistry','A',templateFixture('A')),z=new Zip(output),doc=new DOMParser().parseFromString(z.file('word/document.xml').asText(),'application/xml');
 assert.equal(inspect(output).questions.length,50);assert.ok(inspect(output).questions.every(q=>q.answer==='B'&&!q.answer_error));assert.equal(doc.getElementsByTagName('wp:anchor').length,250);
 const names=Array.from(doc.getElementsByTagName('wp:docPr')).map(n=>n.getAttribute('name'));for(let i=0;i<50;i++)assert.deepEqual(names.slice(i*5,i*5+5),['reaction','A','B','C','D']);
 assert.ok(Array.from(doc.getElementsByTagName('wp:posOffset')).every(n=>n.textContent==='167005'));
 const candidate=examCopy(output);assert.equal(new DOMParser().parseFromString(new Zip(candidate).file('word/document.xml').asText(),'application/xml').getElementsByTagName('wp:anchor').length,250);assert.ok(inspect(candidate).questions.every(q=>q.answer===null));
});
