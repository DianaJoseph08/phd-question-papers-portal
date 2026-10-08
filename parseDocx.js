const fs = require('fs');
const PizzaZip = require('pizzip');

function parseQuestionPaperDocx(filePath) {
    const content = fs.readFileSync(filePath);
    const zip = new PizzaZip(content);
    if (!zip.files['word/document.xml']) {
        throw new Error("Invalid DOCX file structure: missing word/document.xml");
    }
    const docXml = zip.files['word/document.xml'].asText();

    const numIdToFmt = {};
    if (zip.files['word/numbering.xml']) {
        const numXml = zip.files['word/numbering.xml'].asText();
        const abstractNums = {};
        for (const match of numXml.matchAll(/<w:abstractNum\b[^>]*\w:abstractNumId="(\d+)"([\s\S]*?)<\/w:abstractNum>/g)) {
            const absId = match[1];
            const lvls = {};
            for (const lvlMatch of match[2].matchAll(/<w:lvl\b[^>]*\w:ilvl="(\d+)"([\s\S]*?)<\/w:lvl>/g)) {
                const fmtMatch = lvlMatch[2].match(/<w:numFmt\b[^>]*\w:val="([^"]+)"/);
                lvls[lvlMatch[1]] = fmtMatch ? fmtMatch[1] : 'unknown';
            }
            abstractNums[absId] = lvls;
        }
        for (const match of numXml.matchAll(/<w:num\b[^>]*\w:numId="(\d+)"([\s\S]*?)<\/w:num>/g)) {
            const absMatch = match[2].match(/<w:abstractNumId\b[^>]*\w:val="(\d+)"/);
            if (absMatch) numIdToFmt[match[1]] = abstractNums[absMatch[1]];
        }
    }

    const pMatches = docXml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g);
    const paragraphs = [];
    for (const m of pMatches) {
        const pXml = m[0];
        let text = pXml.replace(/<\/w:t>/g, ' </w:t>').replace(/<[^>]+>/g, '')
                       .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                       .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();
        if (!text) continue;

        const numIdMatch = pXml.match(/<w:numId\b[^>]*\w:val="(\d+)"/);
        const numId = numIdMatch ? numIdMatch[1] : null;
        const ilvlMatch = pXml.match(/<w:ilvl\b[^>]*\w:val="(\d+)"/);
        const ilvl = ilvlMatch ? ilvlMatch[1] : '0';
        const fmt = numId ? (numIdToFmt[numId] ? numIdToFmt[numId][ilvl] : null) : null;

        const boldRuns = [];
        for (const rMatch of pXml.matchAll(/<w:r\b[^>]*>(.*?)<\/w:r>/g)) {
            const rXml = rMatch[0];
            if (rXml.includes('<w:b/>') || rXml.includes('<w:bCs/>')) {
                let rText = rXml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
                               .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                               .replace(/\s+/g, ' ').trim();
                if (rText.length > 1) boldRuns.push(rText);
            }
        }
        paragraphs.push({ text, numId, fmt, ilvl, boldRuns });
    }

    function extractOptions(text) {
        const opts = {};
        const optRegex = /(?:^|\s|\(|:)?(?:([A-Da-d])[\.\)]|\(([A-Da-d])\))\s*/g;
        const matches = [];
        let m;
        while ((m = optRegex.exec(text)) !== null) {
            const letter = (m[1] || m[2]).toUpperCase();
            matches.push({ letter, index: m.index, matchEnd: optRegex.lastIndex });
        }
        if (matches.length >= 2) {
            for (let i = 0; i < matches.length; i++) {
                const current = matches[i];
                const next = matches[i + 1];
                const end = next ? next.index : text.length;
                opts[current.letter] = text.substring(current.matchEnd, end).trim();
            }
        } else if (matches.length === 1) {
            opts[matches[0].letter] = text.substring(matches[0].matchEnd).trim();
        }
        return { opts, firstIndex: matches.length > 0 ? matches[0].index : -1 };
    }

    const isInstructionOrMetadata = (p) => {
        return /instructions|omr\s*sheet|multiple\s*choice|four\s*options|negative\s*marking|ballpoint|rough\s*work|calculators?|maximum\s*marks|duration|printed\s*resources|college\s*of|faculty\s*of|equal\s*marks|examination\s*hall|electronic\s*devices|question\s*paper\s*consists/i.test(p)
            || /^(?:Name|Department|Date|Duration|Signature|Roll\s*No|Reg\s*No|Application\s*No)\s*[:_]/i.test(p);
    };

    const isSectionHeader = (p) => {
        return /^(?:Section|Part)\s*[A-B]/i.test(p)
            || /Research Methodology\s*(?:\(\d+|\b)/i.test(p)
            || /Subject-Specific\s*(?:Questions|\(\d+|\b)/i.test(p);
    };

    const isAnswerKey = (p) => {
        return /^(?:Answer\s*Key|Key\s*to\s*Questions|Correct\s*Option|Answer\s*Sheet)\b/i.test(p);
    };

    const questions = [];
    let currentSection = 'A';
    let lastValidQNo = 0;

    for (let i = 0; i < paragraphs.length; i++) {
        const pObj = paragraphs[i];
        let p = pObj.text;

        if (isAnswerKey(p)) break;

        if (p.includes('Section A') || /Research Methodology/i.test(p)) {
            currentSection = 'A';
            lastValidQNo = 0;
            continue;
        }
        if (p.includes('Section B') || /Subject-Specific/i.test(p) || /Subject Specific/i.test(p) || /\b(?:Questions\s*)?\(\s*25\s*[×x*]\s*1\s*=\s*25\s*\)/i.test(p) || /[A-Za-z]+\s+Questions\b/i.test(p)) {
            currentSection = 'B';
            lastValidQNo = 25;
            continue;
        }

        if (isInstructionOrMetadata(p) || isSectionHeader(p)) continue;

        const inlineMatch = p.match(/^\s*(?:Q\.?\s*|Question\s*)?(\d+)\s*[\.\)\:\-]\s*(.*)/i);
        const standaloneMatch = p.match(/^\s*(\d{1,2})\s*$/);
        const isDecimalList = (pObj.fmt === 'decimal');

        let isNewQuestion = false;
        let qNo = null;
        let qText = '';
        let isStandaloneNumber = false;

        const expectedQNo = (lastValidQNo === 0) ? (currentSection === 'B' ? 26 : 1) : (lastValidQNo + 1);

        if (inlineMatch) {
            const rawNo = parseInt(inlineMatch[1], 10);
            const isFloat = /^\d+\.\s*\d+/.test(p);
            if (rawNo >= 1 && rawNo <= 50 && !isFloat) {
                if (currentSection === 'B' && rawNo < 20) {
                    isNewQuestion = false;
                } else if (lastValidQNo > 0 && rawNo < lastValidQNo && (lastValidQNo - rawNo) > 3) {
                    isNewQuestion = false;
                } else {
                    isNewQuestion = true;
                    qNo = rawNo;
                    qText = inlineMatch[2].trim();
                }
            }
        } else if (standaloneMatch) {
            const rawNo = parseInt(standaloneMatch[1], 10);
            if (rawNo >= 1 && rawNo <= 50) {
                if (currentSection === 'B' && rawNo < 20) {
                    isNewQuestion = false;
                } else if (lastValidQNo > 0 && rawNo < lastValidQNo && (lastValidQNo - rawNo) > 3) {
                    isNewQuestion = false;
                } else if (i + 1 < paragraphs.length && !isInstructionOrMetadata(paragraphs[i + 1].text)) {
                    isNewQuestion = true;
                    qNo = rawNo;
                    qText = '';
                    isStandaloneNumber = true;
                }
            }
        } else if (isDecimalList) {
            isNewQuestion = true;
            qNo = expectedQNo;
            qText = p;
        }

        if (isNewQuestion) {
            lastValidQNo = qNo;
            let collectedOptions = {};
            let boldRunsCombined = [...pObj.boldRuns];

            let lookAheadIndex = i + 1;
            if (isStandaloneNumber && lookAheadIndex < paragraphs.length) {
                const nextPObj = paragraphs[lookAheadIndex];
                qText = nextPObj.text;
                boldRunsCombined = boldRunsCombined.concat(nextPObj.boldRuns);
                lookAheadIndex++;
            }

            const inlineOpts = extractOptions(qText);
            if (Object.keys(inlineOpts.opts).length >= 2) {
                collectedOptions = { ...inlineOpts.opts };
                if (inlineOpts.firstIndex > 0) {
                    qText = qText.substring(0, inlineOpts.firstIndex).trim();
                }
            }

            while (lookAheadIndex < paragraphs.length && Object.keys(collectedOptions).length < 4) {
                const nextPObj = paragraphs[lookAheadIndex];
                const nextP = nextPObj.text;

                if (isAnswerKey(nextP) || isSectionHeader(nextP)) break;
                if (isInstructionOrMetadata(nextP)) {
                    lookAheadIndex++;
                    continue;
                }

                const nextInline = nextP.match(/^\s*(?:Q\.?\s*|Question\s*)?(\d+)\s*[\.\)\:\-]\s*/i);
                if (nextInline) {
                    const nextRaw = parseInt(nextInline[1], 10);
                    const isNextFloat = /^\d+\.\s*\d+/.test(nextP);
                    const isSubBullet = (currentSection === 'B' && nextRaw < 20);
                    if (nextRaw >= 1 && nextRaw <= 50 && !isNextFloat && !isSubBullet) {
                        break;
                    }
                }
                const nextStandalone = nextP.match(/^\s*(\d{1,2})\s*$/);
                if (nextStandalone) {
                    const nextRaw = parseInt(nextStandalone[1], 10);
                    const isSubBullet = (currentSection === 'B' && nextRaw < 20);
                    if (nextRaw >= 1 && nextRaw <= 50 && !isSubBullet) {
                        break;
                    }
                }
                if (nextPObj.fmt === 'decimal') {
                    break;
                }

                boldRunsCombined = boldRunsCombined.concat(nextPObj.boldRuns);

                const extracted = extractOptions(nextP);
                if (Object.keys(extracted.opts).length > 0) {
                    Object.assign(collectedOptions, extracted.opts);
                } else if (nextPObj.fmt === 'upperLetter' || nextPObj.fmt === 'lowerLetter') {
                    const letters = ['A', 'B', 'C', 'D'];
                    const existingCount = Object.keys(collectedOptions).length;
                    if (existingCount < 4) {
                        collectedOptions[letters[existingCount]] = nextP;
                    }
                } else {
                    const letters = ['A', 'B', 'C', 'D'];
                    const existingCount = Object.keys(collectedOptions).length;
                    if (existingCount > 0 && existingCount < 4) {
                        collectedOptions[letters[existingCount]] = nextP;
                    } else if (existingCount === 0) {
                        if (/^\d+(?:\.\d+)?\s*(?:Kpa|m|cm|%|kg|N|s)?$/i.test(nextP) || nextP.length < 50) {
                            collectedOptions['A'] = nextP;
                        } else {
                            qText += ' ' + nextP;
                        }
                    }
                }

                lookAheadIndex++;
            }

            i = lookAheadIndex - 1;

            let correctOption = null;
            for (const letter of ['A', 'B', 'C', 'D']) {
                if (!collectedOptions[letter]) continue;
                const optText = collectedOptions[letter].toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!optText) continue;
                const hasMatch = boldRunsCombined.some(br => {
                    const brClean = br.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return brClean.includes(optText) || optText.includes(brClean);
                });
                if (hasMatch) {
                    correctOption = letter;
                    break;
                }
            }

            questions.push({
                section: currentSection,
                qNo: qNo,
                question: qText || ('Question ' + qNo),
                options: {
                    A: collectedOptions.A || '',
                    B: collectedOptions.B || '',
                    C: collectedOptions.C || '',
                    D: collectedOptions.D || ''
                },
                answer: correctOption
            });
        }
    }

    return questions;
}

module.exports = { parseQuestionPaperDocx };
