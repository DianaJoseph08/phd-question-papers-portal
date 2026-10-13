const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),Zip=require('pizzip');
const {inspect,generate}=require('./papers'),{templateFixture}=require('./test-template'),{DOMParser}=require('@xmldom/xmldom');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function source(t,{common=false,image=false,math=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qp-template-test-'));t.after(()=>{const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});});
 const p=s=>`<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="16"/></w:rPr><w:t>${s}</w:t></w:r></w:p>`;let body='';
 for(const section of common?['Research Methodology']:['Research Methodology','Subject-Specific Questions']){
  body+=p(section);for(let i=1;i<=25;i++){
   body+=math?`<w:p><w:r><w:t>${i}. Which result applies to ${section} sample ${i}? A) alpha B) </w:t></w:r><m:oMath><m:r><m:t>x=2</m:t></m:r></m:oMath><w:r><w:t> C) gamma D) delta</w:t></w:r></w:p>`:p(`${i}. Which result applies to ${section} sample ${i}? A) alpha B) beta C) gamma D) delta`);
   if(image)body+='<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Question image"/><a:graphic><a:graphicData><a:blip r:embed="rIdFooter"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
 }
 body+=p('Answer Key');for(let i=1;i<=(common?25:50);i++)body+=p(i+' B');const z=new Zip();
 z.file('word/document.xml',`<w:document xmlns:w="${W}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`);
 if(image){z.file('word/media/image1.png',Buffer.from('synthetic-image'));z.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>');z.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/></Types>');}
 const file=path.join(dir,'source.docx'),buffer=z.generate({type:'nodebuffer'});fs.writeFileSync(file,buffer);return inspect(buffer).questions.map(q=>({...q,source:{path:file}}));
}
test('generation requires the administrator template instead of silently using a built-in layout',()=>{
 assert.throws(()=>generate([],'Civil','A'),/administrator Set A Word template/);
 assert.throws(()=>generate([],'Civil','A',Buffer.from('invalid')),/zip|end of central/i);
});
test('admin layout, footer, styles and key grid are preserved while questions and answers fill its slots',t=>{
 const selected=source(t,{math:true}),template=new Zip(templateFixture('B'));template.file('customXml/item1.xml','<admin-layout/>');
 const output=new Zip(generate(selected,'Civil Engineering','B',template.generate({type:'nodebuffer'}),{facultyName:'Faculty of Engineering and Technology'})),xml=output.file('word/document.xml').asText();
 for(const part of ['word/styles.xml','word/footer1.xml','customXml/item1.xml'])assert.deepEqual(output.file(part).asNodeBuffer(),template.file(part).asNodeBuffer());
 assert.ok(xml.includes('Official Template B')&&xml.includes('Instructions supplied by administrator B'));assert.ok(xml.includes('DEPARTMENT OF Civil Engineering'));assert.ok(xml.includes('FACULTY OF Engineering and Technology'));assert.ok(xml.includes('w:top="1800"'));assert.ok(!xml.includes('Question starts here')&&!xml.includes('Option A'));
 const parsed=inspect(output.generate({type:'nodebuffer'}));assert.deepEqual(parsed.counts,{research:25,subject:25});assert.ok(parsed.questions.every(q=>q.answer==='B'&&!q.answer_error));
 const d=new DOMParser().parseFromString(xml,'application/xml'),questionPs=parsed.questions[0].xml;assert.equal((questionPs.match(/<w:p[\s>]/g)||[]).length,5);assert.ok(questionPs.includes('Georgia')&&!questionPs.includes('Arial'));assert.ok(xml.includes('m:oMath')&&xml.includes('x=2'));
 assert.equal(d.getElementsByTagName('w:tr').length,26);assert.equal(d.getElementsByTagName('w:gridCol')[0].getAttribute('w:w'),'2000');
});
test('Common RM output uses the admin template with 25 answers and no unused subject questions',t=>{
 const output=generate(source(t,{common:true}),'Common Research Methodology','A',templateFixture('A'));
 const xml=new Zip(output).file('word/document.xml').asText(),d=new DOMParser().parseFromString(xml,'application/xml'),parsed=inspect(output);
 assert.equal(parsed.questions.length,25);assert.ok(parsed.questions.every(q=>q.answer==='B'));assert.ok(!xml.includes('Subject-Specific Questions'));assert.equal(d.getElementsByTagName('w:tr').length,14);
});
test('question images are imported without overwriting template relationships or template media',t=>{
 const selected=source(t,{image:true}),template=new Zip(templateFixture('A'));template.file('word/media/image1.png','admin-logo');
 const output=new Zip(generate(selected,'Civil','A',template.generate({type:'nodebuffer'})));assert.equal(output.file('word/media/image1.png').asText(),'admin-logo');
 const rels=new DOMParser().parseFromString(output.file('word/_rels/document.xml.rels').asText(),'application/xml'),rows=Array.from(rels.getElementsByTagName('Relationship'));
 assert.equal(rows.find(n=>n.getAttribute('Id')==='rIdFooter').getAttribute('Target'),'footer1.xml');assert.equal(new Set(rows.map(n=>n.getAttribute('Id'))).size,rows.length);
 for(const r of rows.filter(n=>n.getAttribute('Type').endsWith('/image')))assert.ok(output.file('word/'+r.getAttribute('Target')));
 const doc=new DOMParser().parseFromString(output.file('word/document.xml').asText(),'application/xml'),ids=Array.from(doc.getElementsByTagName('wp:docPr')).map(n=>n.getAttribute('id'));assert.equal(ids.length,50);assert.equal(new Set(ids).size,50);
});
test('two-column admin answer-key tables keep their supplied layout',t=>{
 const output=generate(source(t),'Civil','A',templateFixture('A',{columns:2})),doc=new DOMParser().parseFromString(new Zip(output).file('word/document.xml').asText(),'application/xml');
 assert.equal(doc.getElementsByTagName('w:tr').length,51);assert.equal(doc.getElementsByTagName('w:gridCol').length,2);assert.ok(inspect(output).questions.every(q=>q.answer==='B'));
});
