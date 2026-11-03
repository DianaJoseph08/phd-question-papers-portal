// Explicit Tamil headings: do not infer sections from the number of questions
// or treat ordinary Tamil question text as a heading.
const compact=text=>String(text||'').normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/gu,'').replace(/[.:：]+$/u,'');
const research=new Set([
 'ஆராய்ச்சி நெறிமுறைகள்','ஆய்வு நெறிமுறைகள்','ஆய்வியல் நெறிமுறைகள்',
 'ஆராய்ச்சி முறையியல்','ஆய்வு முறையியல்','ஆராய்ச்சி முறைமை','ஆய்வு முறைமை',
 'ஆராய்ச்சி முறைகள்','ஆய்வு முறைகள்'
].map(compact));
const subject=new Set([
 'தமிழ் இலக்கிய வரலாறு','பாடம் சார்ந்த வினாக்கள்','பாடம் சார்ந்த கேள்விகள்',
 'பாடப்பிரிவு சார்ந்த வினாக்கள்','பாடப்பிரிவு சார்ந்த கேள்விகள்',
 'துறை சார்ந்த வினாக்கள்','துறை சார்ந்த கேள்விகள்','பாடசார் வினாக்கள்'
].map(compact));
const keyTitles=['விடைக்குறிப்பு','விடைக்குறிப்புகள்','விடைக் குறிப்பு','விடைக் குறிப்புகள்','விடை அட்டவணை','விடைகள்'].map(compact).sort((a,b)=>b.length-a.length);
function tamilSectionHeading(value){
 const text=String(value||'').normalize('NFC').trim()
  .replace(/^(?:பகுதி|பிரிவு)\s*[-–—:]?\s*(?:அ|ஆ|[AB12])\s*[.):：–—-]\s*/iu,'')
  .replace(/^(?:section|part)\s*[AB12]\s*[.):：–—-]\s*/i,'')
  .replace(/\s*\([0-9௦-௯][^)]*\)\s*$/u,'');
 const normalized=compact(text);return research.has(normalized)?'research':subject.has(normalized)?'subject':null;
}
function tamilKeyHeading(value){
 const normalized=compact(value);
 const mixed=normalized.match(/^[A-D]*answerkey[:：–—-]?(.*)$/i);
 if(mixed){const scope=tamilSectionHeading(mixed[1]);if(scope)return {heading:true,scope};}
 for(const title of keyTitles)if(normalized.startsWith(title)){
  const remainder=normalized.slice(title.length).replace(/^[:：–—-]+/u,'');
  if(!remainder)return {heading:true,scope:null};
  const scope=tamilSectionHeading(remainder);if(scope)return {heading:true,scope};
 }
 return {heading:false,scope:null};
}
function hasKeyTableLabels(text){
 const normalized=compact(text);
 return (/question\s*(?:no\.?|number)/i.test(text)||['வினாஎண்','கேள்விஎண்'].some(label=>normalized.includes(label)))&&(/correct\s*(?:option|answer)/i.test(text)||['சரியானவிடை','சரியானதெரிவு','சரியானவிருப்பம்'].some(label=>normalized.includes(label)));
}
module.exports={tamilSectionHeading,tamilKeyHeading,hasKeyTableLabels};
