const Zip=require('pizzip');
function templateFixture(set='A',{columns=4}={}){
 const p=(text,extra='')=>`<w:p><w:pPr><w:spacing w:after="0"/>${extra}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="26"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
 const cell=text=>'<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>'+p(text)+'</w:tc>',row=a=>'<w:tr>'+a.map(cell).join('')+'</w:tr>';
 let body=p('Official Template '+set)+p('DEPARTMENT OF ___________________________')+p('FACULTY OF ___________________________')+p('Date: 15 January 2027')+p('Instructions supplied by administrator '+set);
 for(const section of ['Research Methodology','Subject-Specific Questions'])body+=p(section)+p('1. Question starts here')+['A','B','C','D'].map(a=>p(a+') Option '+a)).join('');
 body+=p('Answer Key')+'<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="8"/></w:tblBorders></w:tblPr><w:tblGrid>'+Array(columns).fill('<w:gridCol w:w="2000"/>').join('')+'</w:tblGrid>'+row(columns===4?['Question No.','Correct Option','Question No.','Correct Option']:['Question No.','Correct Option']);
 for(let i=1;i<=(columns===4?25:50);i++)body+=row(columns===4?[i,'',i+25,'']:[i,'']);body+='</w:tbl><w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1800" w:right="1400" w:bottom="1600" w:left="1500"/></w:sectPr>';
 const z=new Zip();z.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`);
 z.file('word/footer1.xml',`<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p('Administrator footer '+set)}</w:ftr>`);
 z.file('word/styles.xml','<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="26"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>');
 z.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>');
 z.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 z.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>');
 return z.generate({type:'nodebuffer'});
}
module.exports={templateFixture};
