const crypto=require('crypto');
function questionHash(text){
 return crypto.createHash('sha256').update(String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu,'')).digest('hex');
}
function generationHashes(questions){
 // Older generated records dropped combining vowel marks in their hashes.
 // Recompute from their saved source text so existing final sets remain excluded
 // without conflating different Tamil words. Legacy records lacking text retain
 // their original hash as a fallback.
 return new Set(questions.map(q=>typeof q.text==='string'?questionHash(q.text):q.hash).filter(Boolean));
}
module.exports={questionHash,generationHashes};
