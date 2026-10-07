const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const PizzaZip = require('pizzip');
const cloudStorage = require('./cloud_storage');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Google Cloud Storage Bucket
cloudStorage.ensureBucketExists().catch(e => console.warn('[Storage] Bucket init warning:', e.message));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database Connection
const dbPath = path.join(__dirname, 'portal.db');
const db = new sqlite3.Database(dbPath);

// Ensure directories
const tempUploadDir = path.join(__dirname, 'uploads', 'temp');
const qpUploadDir = path.join(__dirname, 'uploads', 'question_papers');
const jan27UploadDir = path.join(__dirname, 'uploads', 'Jan27');
[tempUploadDir, qpUploadDir, jan27UploadDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, tempUploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

// Session & Authentication
const activeSessions = new Map(); // token -> user details

app.use((req, res, next) => {
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }
    if (token) {
        const user = activeSessions.get(token);
        if (user) {
            req.user = user;
        }
    }
    next();
});

function requireAuth(roles = []) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized. Please login.' });
        }
        if (roles.length > 0 && !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden. Access denied.' });
        }
        next();
    };
}

// Department & Campus Code Helpers
function getCampusCode(campusName, campusId) {
    if (campusName && campusName.toLowerCase().includes('trichy')) return 'TRY';
    if (campusId === 2 || campusId === '2') return 'TRY';
    return 'RMP';
}

function getDepartmentCode(deptName) {
    if (!deptName) return 'GEN';
    const clean = deptName.trim();
    if (clean.includes('Common Research Methodology') || clean.includes('Research Methodology')) return 'Common_RM';
    const map = {
        'Computer Science and Engineering': 'CSE',
        'Computer Science': 'CS',
        'Mechanical Engineering': 'MECH',
        'Electronics and Communication Engineering': 'ECE',
        'Electrical and Electronics Engineering': 'EEE',
        'Civil Engineering': 'CIVIL',
        'Biotechnology': 'BIOTECH',
        'Biomedical Engineering': 'BME',
        'Physics': 'PHY',
        'Chemistry': 'CHM',
        'Mathematics': 'MATH',
        'English': 'ENG',
        'Commerce': 'COM',
        'Management Studies': 'MBA',
        'MANAGEMENT STUDIES': 'MBA',
        'Dentistry': 'DENTAL',
        'Clinical Psychology': 'PSY',
        'CLINICAL PSYCOLOGY': 'PSY',
        'Visual Communication': 'VISCOM',
        'Fashion Designing': 'FD',
        'Tamil': 'TAM',
        'Hindi': 'HIN',
        'Microbiology': 'MICRO',
        'Biochemistry': 'BIOCHM',
        'Occupational Therapy': 'OT',
        'Medical Imaging Technology': 'MIT',
        'Renal Dialysis Technology': 'RDT',
        'Anaesthesia Technology': 'AT',
        'Physical Education': 'PED'
    };
    if (map[clean]) return map[clean];
    return clean.replace(/[^a-zA-Z]/g, '').slice(0, 6).toUpperCase() || 'DEPT';
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCURATE DOCX MCQ PARSER & QUESTION SIMILARITY ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
    'which', 'of', 'the', 'following', 'is', 'a', 'an', 'what', 'are', 'in', 'to', 'for', 'from',
    'and', 'or', 'by', 'with', 'that', 'this', 'these', 'those', 'how', 'when', 'where', 'why',
    'who', 'not', 'correct', 'incorrect', 'statement', 'statements', 'true', 'false', 'given',
    'below', 'select', 'choose', 'consider', 'identify', 'according', 'type', 'types', 'called',
    'known', 'as', 'one', 'two', 'three', 'four', 'can', 'be', 'does', 'do', 'has', 'have', 'had',
    'among', 'listed', 'specifically', 'classified', 'regarding', 'respect', 'terms', 'primarily',
    'question', 'option', 'each', 'such', 'into', 'both', 'between', 'used', 'using', 'means', 'defined',
    'stated', 'refer', 'refers', 'give', 'given'
]);

function stemToken(t) {
    return t.replace(/(ing|tion|tions|ed|es|s|ly|al|ic|ment|ments)$/, '');
}

function getSignificantTokens(text) {
    if (!text) return [];
    return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
        .map(stemToken);
}

function extractNumbers(text) {
    if (!text) return [];
    return text.match(/\b\d+(?:\.\d+)?\b/g) || [];
}

function computeSetOverlap(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return { jaccard: 0, dice: 0, containment: 0, inter: 0 };
    const sA = new Set(tokensA);
    const sB = new Set(tokensB);
    let inter = 0;
    sA.forEach(t => { if (sB.has(t)) inter++; });
    const jaccard = Math.round((inter / new Set([...tokensA, ...tokensB]).size) * 100);
    const dice = Math.round(((2 * inter) / (sA.size + sB.size)) * 100);
    const containment = Math.round((inter / Math.min(sA.size, sB.size)) * 100);
    return { jaccard, dice, containment, inter };
}

function computeOptionsSimilarity(optsA, optsB) {
    if (!optsA || !optsB) return 0;
    const arrA = Object.values(optsA).filter(Boolean).map(o => o.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim());
    const arrB = Object.values(optsB).filter(Boolean).map(o => o.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim());
    if (arrA.length === 0 || arrB.length === 0) return 0;

    let matched = 0;
    arrA.forEach(a => {
        const found = arrB.some(b => {
            if (a === b) return true;
            const sim = computeSetOverlap(a.split(/\s+/), b.split(/\s+/));
            return sim.dice >= 75 || sim.containment >= 85;
        });
        if (found) matched++;
    });

    return Math.round((matched / Math.max(arrA.length, arrB.length)) * 100);
}

function evaluateMCQMatch(newQ, pastQ) {
    const newText = (newQ.question_text || newQ.question || '').trim();
    const pastText = (pastQ.question_text || pastQ.question || '').trim();

    if (!newText || !pastText) return { isMatch: false, score: 0, matchType: 'No Match', severity: 'LOW' };

    const tNewStem = getSignificantTokens(newText);
    const tPastStem = getSignificantTokens(pastText);
    const stemOverlap = computeSetOverlap(tNewStem, tPastStem);

    const optsNew = newQ.options || { A: newQ.option_a, B: newQ.option_b, C: newQ.option_c, D: newQ.option_d };
    const optsPast = pastQ.options || { A: pastQ.option_a, B: pastQ.option_b, C: pastQ.option_c, D: pastQ.option_d };
    const optScore = computeOptionsSimilarity(optsNew, optsPast);

    const fullNew = getSignificantTokens(newText + ' ' + Object.values(optsNew).filter(Boolean).join(' '));
    const fullPast = getSignificantTokens(pastText + ' ' + Object.values(optsPast).filter(Boolean).join(' '));
    const fullOverlap = computeSetOverlap(fullNew, fullPast);

    const cleanNew = newText.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanPast = pastText.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isExactStem = cleanNew === cleanPast && cleanNew.length > 10;

    const numsNew = extractNumbers(newText);
    const numsPast = extractNumbers(pastText);
    let numInter = 0;
    if (numsNew.length > 0 && numsPast.length > 0) {
        const sNums = new Set(numsPast);
        numsNew.forEach(n => { if (sNums.has(n)) numInter++; });
    }
    const numMatch = numsPast.length > 0 ? (numInter / numsPast.length) >= 0.75 : false;

    // 1. Exact Verbatim Match
    if (isExactStem) {
        return {
            isMatch: true,
            score: 100,
            matchType: 'Exact Verbatim Match (100%)',
            severity: 'HIGH',
            reason: 'Identical question text to past exam paper.'
        };
    }

    // 2. Recycled Answer Choices (Option Clone)
    if (optScore >= 75 && (stemOverlap.containment >= 20 || stemOverlap.inter >= 2 || fullOverlap.containment >= 30)) {
        return {
            isMatch: true,
            score: Math.max(optScore, stemOverlap.dice),
            matchType: optScore >= 95 ? 'Recycled Options (100% Choices Match)' : `Recycled Options (${optScore}% Match)`,
            severity: 'HIGH',
            reason: 'The 4 answer options were copied directly from a past exam question.'
        };
    }

    // 3. Numerical Clone
    if (numMatch && numsNew.length >= 2 && (optScore >= 75 || stemOverlap.inter >= 2)) {
        return {
            isMatch: true,
            score: 95,
            matchType: 'Numerical Clone (Same Problem Values)',
            severity: 'HIGH',
            reason: 'Uses identical numerical values, formulas, and parameters as a past question.'
        };
    }

    // 4. Direct Content Overlap
    if (stemOverlap.dice >= 70 || (stemOverlap.containment >= 80 && stemOverlap.inter >= 3)) {
        return {
            isMatch: true,
            score: Math.max(stemOverlap.dice, stemOverlap.containment),
            matchType: `Direct Question Overlap (${stemOverlap.dice}%)`,
            severity: 'HIGH',
            reason: 'High degree of phrasing and content reuse from past session.'
        };
    }

    // 5. Paraphrased / Rewritten Stem (Concept Overlap)
    if (stemOverlap.containment >= 50 && stemOverlap.inter >= 3) {
        return {
            isMatch: true,
            score: stemOverlap.containment,
            matchType: `Rewritten Stem / Concept Overlap (${stemOverlap.containment}%)`,
            severity: 'MEDIUM',
            reason: 'Paraphrased version of a past question testing the exact same concept.'
        };
    }

    // 6. Inverted / Transformed MCQ
    if (fullOverlap.containment >= 45 && fullOverlap.inter >= 4) {
        return {
            isMatch: true,
            score: fullOverlap.containment,
            matchType: `Rewritten / Inverted MCQ (${fullOverlap.containment}%)`,
            severity: 'MEDIUM',
            reason: 'MCQ components inverted or reworded from a past exam question.'
        };
    }

    return { isMatch: false, score: 0, matchType: 'No Match', severity: 'LOW', reason: '' };
}

// Backward-compatible alias
function computeSimilarity(q1Text, q2Text) {
    const res = evaluateMCQMatch({ question: q1Text }, { question_text: q2Text });
    return { isMatch: res.isMatch, score: res.score, type: res.matchType };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPREHENSIVE QUESTION PAPER AUDIT ENGINE
// ─────────────────────────────────────────────────────────────────────────────

function performDuplicateAudit(parsedQuestions, pastQuestions, currentPaperSetName, oppositeSetQuestions = [], commonRmDeptId = null) {
    const matchedDuplicates = [];

    // 1. Internal Repetition Check (Repeated questions within the same uploaded paper)
    for (let i = 0; i < parsedQuestions.length; i++) {
        for (let j = i + 1; j < parsedQuestions.length; j++) {
            const internalMatch = evaluateMCQMatch(parsedQuestions[i], parsedQuestions[j]);
            if (internalMatch.isMatch && internalMatch.score >= 50) {
                matchedDuplicates.push({
                    category: 'INTERNAL_REPEAT',
                    uploaded_set: currentPaperSetName,
                    uploaded_q_no: parsedQuestions[j].qNo,
                    uploaded_section: parsedQuestions[j].section,
                    uploaded_question_text: parsedQuestions[j].question,
                    uploaded_options: parsedQuestions[j].options,
                    matched_session: 'Current Paper',
                    matched_set: `Set ${currentPaperSetName}`,
                    matched_q_no: parsedQuestions[i].qNo,
                    matched_section: parsedQuestions[i].section,
                    matched_question_text: parsedQuestions[i].question,
                    matched_options: parsedQuestions[i].options,
                    similarity_score: internalMatch.score,
                    match_type: `Internal Duplicate (Repeats Q${parsedQuestions[i].qNo} in this paper)`,
                    severity: 'HIGH',
                    reason: `Repeats Question ${parsedQuestions[i].qNo} in the same question paper.`
                });
            }
        }
    }

    // 2. Cross-Set Duplication Check (Repeats between Set A and Set B of Jan 2027)
    (oppositeSetQuestions || []).forEach(oppQ => {
        parsedQuestions.forEach(q => {
            const crossMatch = evaluateMCQMatch(q, oppQ);
            if (crossMatch.isMatch && crossMatch.score >= 50) {
                matchedDuplicates.push({
                    category: 'CROSS_SET',
                    uploaded_set: currentPaperSetName,
                    uploaded_q_no: q.qNo,
                    uploaded_section: q.section,
                    uploaded_question_text: q.question,
                    uploaded_options: q.options,
                    matched_session: 'January 2027',
                    matched_set: `Set ${oppQ.set_name}`,
                    matched_q_no: oppQ.q_no,
                    matched_section: oppQ.section,
                    matched_question_text: oppQ.question_text,
                    matched_options: { A: oppQ.option_a, B: oppQ.option_b, C: oppQ.option_c, D: oppQ.option_d },
                    similarity_score: crossMatch.score,
                    match_type: `Cross-Set Duplicate (Repeats Set ${oppQ.set_name} Q${oppQ.q_no})`,
                    severity: 'HIGH',
                    reason: `Question repeats content from Set ${oppQ.set_name} Q${oppQ.q_no}.`
                });
            }
        });
    });

    // 3. Past Sessions Recycled Questions Check (Jan 2026, July 2026, Common RM)
    parsedQuestions.forEach(q => {
        if (!q.question || q.question.trim().length < 5) return;

        let bestMatch = null;
        let highestScore = 0;

        (pastQuestions || []).forEach(pq => {
            if (!pq.question_text || pq.question_text.trim().length < 5) return;

            const sim = evaluateMCQMatch(q, pq);
            if (sim.isMatch && sim.score > highestScore) {
                highestScore = sim.score;
                bestMatch = { pastQ: pq, sim: sim };
            }
        });

        if (bestMatch) {
            const match = bestMatch.pastQ;
            let sessionName = 'Past Session';
            let setNameFormatted = match.set_name;
            if (match.set_name.startsWith('JAN')) {
                sessionName = 'January 2026';
                setNameFormatted = match.set_name.replace('JAN_', 'Set ');
            } else if (match.set_name.startsWith('JUL')) {
                sessionName = 'July 2026';
                setNameFormatted = match.set_name.replace('JUL_', 'Set ');
            }

            if (commonRmDeptId && match.department_id === commonRmDeptId) {
                setNameFormatted += ' (Common RM)';
            }

            matchedDuplicates.push({
                category: 'PAST_RECYCLED',
                uploaded_set: currentPaperSetName,
                uploaded_q_no: q.qNo,
                uploaded_section: q.section,
                uploaded_question_text: q.question,
                uploaded_options: q.options,
                matched_session: sessionName,
                matched_set: setNameFormatted,
                matched_q_no: match.q_no,
                matched_section: match.section,
                matched_question_text: match.question_text,
                matched_options: { A: match.option_a, B: match.option_b, C: match.option_c, D: match.option_d },
                similarity_score: bestMatch.sim.score,
                match_type: bestMatch.sim.matchType,
                severity: bestMatch.sim.severity,
                reason: bestMatch.sim.reason
            });
        }
    });

    const recycledCount = matchedDuplicates.filter(d => d.category === 'PAST_RECYCLED').length;
    const optionClonesCount = matchedDuplicates.filter(d => d.match_type && d.match_type.includes('Recycled Options')).length;
    const internalCount = matchedDuplicates.filter(d => d.category === 'INTERNAL_REPEAT').length;
    const crossSetCount = matchedDuplicates.filter(d => d.category === 'CROSS_SET').length;

    return {
        matchedDuplicates,
        recycledCount,
        optionClonesCount,
        internalCount,
        crossSetCount,
        duplicateCount: matchedDuplicates.length
    };
}

function parseQuestionPaperDocx(filePath) {
    const content = fs.readFileSync(filePath);
    const zip = new PizzaZip(content);
    if (!zip.files['word/document.xml']) {
        throw new Error("Invalid DOCX file structure. missing word/document.xml");
    }

    const numIdToFmt = {};
    if (zip.files['word/numbering.xml']) {
        const numXml = zip.files['word/numbering.xml'].asText();
        const abstractNums = {};
        const absMatches = numXml.matchAll(/<w:abstractNum\b[^>]*\w:abstractNumId="(\d+)"([\s\S]*?)<\/w:abstractNum>/g);
        for (const match of absMatches) {
            const absId = match[1];
            const inner = match[2];
            const lvls = {};
            const lvlMatches = inner.matchAll(/<w:lvl\b[^>]*\w:ilvl="(\d+)"([\s\S]*?)<\/w:lvl>/g);
            for (const lvlMatch of lvlMatches) {
                const ilvl = lvlMatch[1];
                const lvlInner = lvlMatch[2];
                const fmtMatch = lvlInner.match(/<w:numFmt\b[^>]*\w:val="([^"]+)"/);
                lvls[ilvl] = fmtMatch ? fmtMatch[1] : 'unknown';
            }
            abstractNums[absId] = lvls;
        }
        const numMatches = numXml.matchAll(/<w:num\b[^>]*\w:numId="(\d+)"([\s\S]*?)<\/w:num>/g);
        for (const match of numMatches) {
            const numId = match[1];
            const inner = match[2];
            const absMatch = inner.match(/<w:abstractNumId\b[^>]*\w:val="(\d+)"/);
            if (absMatch) {
                numIdToFmt[numId] = abstractNums[absMatch[1]];
            }
        }
    }

    const docXml = zip.files['word/document.xml'].asText();
    const pXmls = [];
    let tableDepth = 0;
    const tagRegex = /<\/?w:(tbl|p)\b/g;
    let tagMatch;
    let currentPStart = -1;
    
    while ((tagMatch = tagRegex.exec(docXml)) !== null) {
        const tag = tagMatch[0];
        if (tag === '<w:tbl') {
            tableDepth++;
        } else if (tag === '</w:tbl') {
            tableDepth--;
        } else if (tag === '<w:p') {
            if (tableDepth === 0) {
                currentPStart = tagMatch.index;
            }
        } else if (tag === '</w:p') {
            if (tableDepth === 0 && currentPStart !== -1) {
                const closeIndex = docXml.indexOf('>', tagMatch.index);
                if (closeIndex !== -1) {
                    pXmls.push(docXml.substring(currentPStart, closeIndex + 1));
                }
                currentPStart = -1;
            }
        }
    }

    const paragraphs = [];
    pXmls.forEach(pXml => {
        let text = pXml.replace(/<\/w:t>/g, ' </w:t>').replace(/<[^>]+>/g, '')
                       .replace(/&amp;/g, '&')
                       .replace(/&lt;/g, '<')
                       .replace(/&gt;/g, '>')
                       .replace(/&quot;/g, '"')
                       .replace(/&apos;/g, "'")
                       .replace(/&nbsp;/g, ' ')
                       .replace(/\s+/g, ' ')
                       .trim();
        if (text.length === 0) return;

        const numIdMatch = pXml.match(/<w:numId\b[^>]*\w:val="(\d+)"/);
        const numId = numIdMatch ? numIdMatch[1] : null;

        const ilvlMatch = pXml.match(/<w:ilvl\b[^>]*\w:val="(\d+)"/);
        const ilvl = ilvlMatch ? ilvlMatch[1] : '0';

        const fmt = numId ? (numIdToFmt[numId] ? numIdToFmt[numId][ilvl] : null) : null;

        const boldRuns = [];
        const rMatches = pXml.matchAll(/<w:r\b[^>]*>(.*?)<\/w:r>/g);
        for (const rMatch of rMatches) {
            const rXml = rMatch[0];
            const isBold = rXml.includes('<w:b/>') || rXml.includes('<w:bCs/>') || rXml.includes('w:val="12"');
            if (isBold) {
                let rText = rXml.replace(/<[^>]+>/g, '')
                                 .replace(/&amp;/g, '&')
                                 .replace(/&lt;/g, '<')
                                 .replace(/&gt;/g, '>')
                                 .replace(/&quot;/g, '"')
                                 .replace(/&apos;/g, "'")
                                 .replace(/&nbsp;/g, ' ')
                                 .replace(/\s+/g, ' ').trim();
                if (rText.length > 1) { 
                    boldRuns.push(rText);
                }
            }
        }

        paragraphs.push({
            text: text,
            numId: numId,
            fmt: fmt,
            ilvl: ilvl,
            boldRuns: boldRuns
        });
    });

    // Option extractor supporting single-line, dual-line, and 4-line option layouts
    function extractOptions(text) {
        const opts = {};
        const optRegex = /(?:^|\s|\()(?:\(?([A-Da-d])[\)\.\:]|\b([A-Da-d])[\.\)])\s*/g;
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

    const questions = [];
    let currentSection = 'A';

    for (let i = 0; i < paragraphs.length; i++) {
        const pObj = paragraphs[i];
        let p = pObj.text;

        if (p.includes('Section A') || p.includes('Research Methodology')) {
            currentSection = 'A';
            continue;
        }
        if (p.includes('Section B') || p.includes('Subject-Specific') || p.includes('Subject Specific')) {
            currentSection = 'B';
            continue;
        }

        // Skip instructions/exam metadata
        if (p.includes('Instructions to candidates') || p.includes('OMR sheet') || p.includes('Multiple Choice Questions') || p.includes('Duration') || p.includes('Maximum Marks') || p.includes('rough work') || p.includes('MCQ Type Question Paper')) {
            continue;
        }

        // Match question start: manual number (e.g. 1., 25), Q.1:) or Word decimal list
        const manualMatch = p.match(/^\s*(?:Q\.?\s*)?(\d+)[\.\)\:\-]\s*(.*)/i);
        const isDecimalList = pObj.fmt === 'decimal';
        const isQuestion = manualMatch || isDecimalList;

        if (isQuestion) {
            let qNo = manualMatch ? parseInt(manualMatch[1], 10) : null;
            let qText = manualMatch ? manualMatch[2].trim() : p;

            let collectedOptions = {};
            let boldRunsCombined = [...pObj.boldRuns];

            // 1. Check if options are attached inside the question text itself
            const inlineOpts = extractOptions(qText);
            if (Object.keys(inlineOpts.opts).length >= 2) {
                collectedOptions = { ...inlineOpts.opts };
                if (inlineOpts.firstIndex > 0) {
                    qText = qText.substring(0, inlineOpts.firstIndex).trim();
                }
            }

            // 2. Lookahead into following paragraphs for options
            let lookAheadIndex = i + 1;
            while (lookAheadIndex < paragraphs.length && Object.keys(collectedOptions).length < 4) {
                const nextPObj = paragraphs[lookAheadIndex];
                const nextP = nextPObj.text;

                // Stop if next paragraph is clearly another question
                const nextManualMatch = nextP.match(/^\s*(?:Q\.?\s*)?(\d+)[\.\)\:\-]\s*/i);
                const nextIsDecimal = nextPObj.fmt === 'decimal';
                if ((nextManualMatch || nextIsDecimal) && Object.keys(collectedOptions).length > 0) {
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
                    // Continuation of question text before options appear
                    if (Object.keys(collectedOptions).length === 0) {
                        qText += ' ' + nextP;
                    }
                }

                lookAheadIndex++;
                if (Object.keys(collectedOptions).length === 4) {
                    break;
                }
            }

            // If we found at least 2 options, treat as a valid question
            if (Object.keys(collectedOptions).length >= 2) {
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

                if (!qNo) {
                    const sectionQs = questions.filter(q => q.section === currentSection);
                    qNo = (currentSection === 'A' ? 1 : 26) + sectionQs.length;
                }

                questions.push({
                    section: currentSection,
                    qNo: qNo,
                    question: qText,
                    options: collectedOptions,
                    answer: correctOption
                });
            }
        }
    }
    return questions;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
    let { username, password } = req.body;
    if (username) username = username.trim();
    if (password) password = password.trim();

    const sql = `
        SELECT u.*, c.name as campus_name, i.name as institution_name, d.name as department_name
        FROM users u
        LEFT JOIN campuses c ON u.campus_id = c.id
        LEFT JOIN institutions i ON u.institution_id = i.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE LOWER(u.username) = LOWER(?) AND u.password = ?
    `;

    db.get(sql, [username, password], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'Invalid username or password' });

        const token = `token_${user.id}_${Date.now()}`;
        activeSessions.set(token, user);

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                campus_id: user.campus_id,
                campus_name: user.campus_name,
                institution_id: user.institution_id,
                institution_name: user.institution_name,
                department_id: user.department_id,
                department_name: user.department_name
            }
        });
    });
});

app.get('/api/auth/me', requireAuth(), (req, res) => {
    db.all("SELECT key, value FROM settings", (err, rows) => {
        const settings = {};
        if (rows) rows.forEach(r => settings[r.key] = r.value);
        res.json({ user: req.user, settings });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// HOD QUESTION PAPER ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// Get Status of Set A and Set B for Logged-in HOD
app.get('/api/hod/question-papers', requireAuth(['hod']), (req, res) => {
    const user = req.user;
    db.all(`SELECT id, set_name, file_name, file_path, created_at 
            FROM question_papers 
            WHERE department_id = ? AND campus_id = ? AND set_name IN ('A', 'B')`,
        [user.department_id, user.campus_id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ questionPapers: rows });
        }
    );
});

// Upload Question Paper (Set A or Set B) with Duplicate Detection Check
app.post('/api/hod/upload-question-paper', requireAuth(['hod']), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { set } = req.body;
    if (!set || !['A', 'B'].includes(set.toUpperCase())) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Invalid set option. Must be 'A' or 'B'." });
    }

    const setName = set.toUpperCase();
    const user = req.user;
    const campusId = user.campus_id;
    const deptId = user.department_id;

    // Fetch department and campus details
    db.get(`SELECT d.name as dept_name, c.name as campus_name 
            FROM departments d
            LEFT JOIN campuses c ON c.id = ?
            WHERE d.id = ?`, [campusId, deptId], (dcErr, dcRow) => {
        if (dcErr || !dcRow) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(500).json({ error: dcErr ? dcErr.message : "Department / Campus not found" });
        }

        const deptName = dcRow.dept_name;
        const campusName = dcRow.campus_name;
        const campusCode = getCampusCode(campusName, campusId);
        const deptCode = getDepartmentCode(deptName);
        const session = 'Jan27';

        // Auto-naming format: RMP_A_CSE_Jan27.docx / TRY_B_MECH_Jan27.docx
        const standardFilename = `${campusCode}_${setName}_${deptCode}_${session}.docx`;
        const organizedDir = path.join(__dirname, 'uploads', 'Jan27', campusCode, deptCode);
        if (!fs.existsSync(organizedDir)) {
            fs.mkdirSync(organizedDir, { recursive: true });
        }
        const organizedFilePath = path.join(organizedDir, standardFilename);
        const legacyPath = path.join(qpUploadDir, `${deptId}_${campusId}_${setName}.docx`);

        try {
            // Parse DOCX MCQs
            const parsedQuestions = parseQuestionPaperDocx(req.file.path);
            if (!parsedQuestions || parsedQuestions.length === 0) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: "Could not parse any MCQs from the question paper. Please ensure you are using the official DOCX template." });
            }

            // Fetch past questions for this department across past sessions (Jan 2026, July 2026)
            // For Engineering & Technology (institution_id 1 for Ramapuram, 5 for Trichy), Section A also checks Common RM (201/202)
            const commonRmDeptId = (user.institution_id === 1 || campusId === 1) ? 201 : ((user.institution_id === 5 || campusId === 2) ? 202 : null);
            const isEtFaculty = user.institution_id === 1 || user.institution_id === 5;

            let pqSql = `
                SELECT q.q_no, q.section, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer,
                       qp.set_name, qp.file_name, qp.department_id 
                FROM questions q 
                JOIN question_papers qp ON q.question_paper_id = qp.id 
                JOIN departments d ON qp.department_id = d.id 
                WHERE (qp.department_id = ? ${isEtFaculty && commonRmDeptId ? `OR (qp.department_id = ${commonRmDeptId} AND q.section = 'A')` : ''})
                  AND qp.set_name NOT IN ('A', 'B')
            `;

            // Also fetch opposite set from current session to check cross-set repeats
            const oppSetName = (setName === 'A') ? 'B' : 'A';
            let oppSql = `
                SELECT q.q_no, q.section, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer,
                       qp.set_name, qp.file_name, qp.department_id
                FROM questions q
                JOIN question_papers qp ON q.question_paper_id = qp.id
                WHERE qp.department_id = ? AND qp.campus_id = ? AND qp.set_name = ?
            `;

            db.all(pqSql, [deptId], (pqErr, pastQuestions) => {
                if (pqErr) {
                    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                    return res.status(500).json({ error: pqErr.message });
                }

                db.all(oppSql, [deptId, campusId, oppSetName], (oppErr, oppQuestions) => {
                    const audit = performDuplicateAudit(parsedQuestions, pastQuestions, setName, oppQuestions || [], commonRmDeptId);
                    const matchedDuplicates = audit.matchedDuplicates;
                    const duplicateCount = audit.duplicateCount;
                    const recycledCount = audit.recycledCount;
                    const internalCount = audit.internalCount;
                    const crossSetCount = audit.crossSetCount;

                    // Rejection Policy:
                    // 1. Recycled from past sessions > 10 (exceeds 10 question limit)
                    // 2. OR internal duplicates > 0 (setter repeated questions inside their own paper)
                    // 3. OR cross-set repeats > 0 (repeated across Set A and Set B)
                    if (recycledCount > 10 || internalCount > 0 || crossSetCount > 0) {
                        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                        const reasons = [];
                        if (recycledCount > 10) {
                            reasons.push(`${recycledCount} questions recycled from past sessions (January/July 2026), exceeding the limit of 10`);
                        }
                        if (internalCount > 0) {
                            reasons.push(`${internalCount} internal duplicate question(s) repeated inside this same paper`);
                        }
                        if (crossSetCount > 0) {
                            reasons.push(`${crossSetCount} question(s) repeated across Set A and Set B`);
                        }
                        return res.status(400).json({ 
                            error: `Upload rejected: ${reasons.join('; ')}.`,
                            duplicateCount: duplicateCount,
                            recycledCount: recycledCount,
                            internalCount: internalCount,
                            crossSetCount: crossSetCount,
                            maxAllowed: 10,
                            duplicates: matchedDuplicates
                        });
                    }

                    // Save file to organized directory & legacy path
                    fs.copyFileSync(req.file.path, organizedFilePath);
                    fs.copyFileSync(req.file.path, legacyPath);
                    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

                    // Permanent Cloud Storage Bucket: Save/Overwrite in Google Cloud Storage
                    const gcsKey = `Jan27/${campusCode}/${deptCode}/${standardFilename}`;
                    cloudStorage.saveToCloudStorage(organizedFilePath, gcsKey).catch(e => console.warn('[Storage] GCS upload:', e.message));

                    // Save to database
                    const relativeFilePath = `/uploads/Jan27/${campusCode}/${deptCode}/${standardFilename}`;
                    db.serialize(() => {
                        db.run('BEGIN TRANSACTION');

                        db.run(`INSERT OR REPLACE INTO question_papers 
                            (department_id, campus_id, set_name, file_name, file_path, uploaded_by) 
                            VALUES (?, ?, ?, ?, ?, ?)`,
                            [deptId, campusId, setName, standardFilename, relativeFilePath, user.id],
                            function(insQpErr) {
                                if (insQpErr) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: insQpErr.message });
                                }

                                const qpId = this.changes === 0 ? null : this.lastID;

                                const insertQuestions = (paperId) => {
                                    db.run(`DELETE FROM questions WHERE question_paper_id = ?`, [paperId], (delErr) => {
                                        if (delErr) {
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ error: delErr.message });
                                        }

                                        const stmt = db.prepare(`INSERT INTO questions 
                                            (question_paper_id, section, q_no, question_text, option_a, option_b, option_c, option_d, correct_answer) 
                                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

                                        parsedQuestions.forEach(q => {
                                            stmt.run(paperId, q.section, q.qNo, q.question, q.options.A || '', q.options.B || '', q.options.C || '', q.options.D || '', q.answer || null);
                                        });

                                        stmt.finalize((finErr) => {
                                            if (finErr) {
                                                db.run('ROLLBACK');
                                                return res.status(500).json({ error: finErr.message });
                                            }

                                            db.run('COMMIT', (commitErr) => {
                                                if (commitErr) {
                                                    return res.status(500).json({ error: commitErr.message });
                                                }
                                                res.json({
                                                    success: true,
                                                    message: `Set ${setName} successfully validated and saved as "${standardFilename}". (${duplicateCount} repeated questions detected, allowed: ≤ 10).`,
                                                    fileName: standardFilename,
                                                    duplicateCount: duplicateCount,
                                                    duplicates: matchedDuplicates,
                                                    questionsParsedCount: parsedQuestions.length
                                                });
                                            });
                                        });
                                    });
                                };

                                if (qpId) {
                                    insertQuestions(qpId);
                                } else {
                                    db.get(`SELECT id FROM question_papers WHERE department_id = ? AND campus_id = ? AND set_name = ?`,
                                        [deptId, campusId, setName], (selectErr, row) => {
                                            if (selectErr || !row) {
                                                db.run('ROLLBACK');
                                                return res.status(500).json({ error: selectErr ? selectErr.message : "Error identifying paper ID" });
                                            }
                                            insertQuestions(row.id);
                                        });
                                }
                            }
                        );
                    });
                });
            });
        } catch (parseErr) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `DOCX Parsing Error: ${parseErr.message}` });
        }
    });
});

// Delete uploaded question paper (Set A or Set B)
app.delete('/api/question-papers/:id', requireAuth(['hod', 'admin', 'super_admin']), (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Question paper ID is required' });

    db.get('SELECT * FROM question_papers WHERE id = ?', [id], (err, paper) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!paper) return res.status(404).json({ error: 'Question paper not found' });

        if (req.user.role === 'hod') {
            if (paper.department_id !== req.user.department_id || paper.campus_id !== req.user.campus_id) {
                return res.status(403).json({ error: 'Access denied: You can only delete papers for your own department.' });
            }
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            db.run('DELETE FROM questions WHERE question_paper_id = ?', [id], (delQErr) => {
                if (delQErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: delQErr.message });
                }

                db.run('DELETE FROM question_papers WHERE id = ?', [id], function(delQPErr) {
                    if (delQPErr) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: delQPErr.message });
                    }

                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) return res.status(500).json({ error: commitErr.message });

                        if (paper.file_path) {
                            const diskPath = path.join(__dirname, paper.file_path.replace(/^\//, ''));
                            if (fs.existsSync(diskPath)) {
                                try { fs.unlinkSync(diskPath); } catch (e) {}
                            }
                            // Delete from Google Cloud Storage Bucket
                            const gcsKey = paper.file_path.replace(/^\/uploads\//, '');
                            cloudStorage.deleteFromCloudStorage(gcsKey).catch(e => console.warn('[Storage] GCS delete:', e.message));
                        }

                        res.json({ success: true, message: 'Question paper deleted successfully.' });
                    });
                });
            });
        });
    });
});

// Download Uploaded Question Paper
app.get('/api/question-papers/download/:id', requireAuth(['hod', 'coordinator', 'admin', 'super_admin']), (req, res) => {
    const id = parseInt(req.params.id);
    db.get('SELECT * FROM question_papers WHERE id = ?', [id], (err, paper) => {
        if (err || !paper) return res.status(404).json({ error: 'File not found' });
        if (req.user.role === 'hod') {
            const isOwn = (paper.department_id === req.user.department_id && paper.campus_id === req.user.campus_id);
            const isCommon = ((paper.department_id === 201 && req.user.campus_id === 1) || (paper.department_id === 202 && req.user.campus_id === 2));
            if (!isOwn && !isCommon) return res.status(403).json({ error: 'Access denied' });
        }
        const candidatePaths = [
            paper.file_path ? path.join(__dirname, paper.file_path.replace(/^\//, '')) : null,
            path.join(__dirname, 'uploads', 'question_papers', `${paper.department_id}_${paper.campus_id}_${paper.set_name}.docx`),
            path.join(__dirname, 'uploads', 'question_papers', path.basename(paper.file_path || ''))
        ].filter(Boolean);

        let diskPath = null;
        for (const p of candidatePaths) {
            if (fs.existsSync(p)) { diskPath = p; break; }
        }
        if (!diskPath) {
            const gcsKey = paper.file_path ? paper.file_path.replace(/^\/uploads\//, '') : null;
            if (gcsKey && cloudStorage.streamFromCloudStorage(gcsKey, res, paper.file_name)) {
                return;
            }
            return res.status(404).json({ error: 'Physical file not found on server or cloud bucket' });
        }
        res.download(diskPath, paper.file_name);
    });
});

// Comprehensive On-Demand Similarity & Integrity Audit Report
app.get('/api/question-papers/:id/audit-report', requireAuth(['hod', 'coordinator', 'admin', 'super_admin']), (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Valid Question Paper ID is required' });

    db.get(`SELECT qp.*, d.name as department_name, c.name as campus_name 
            FROM question_papers qp
            JOIN departments d ON qp.department_id = d.id
            JOIN campuses c ON qp.campus_id = c.id
            WHERE qp.id = ?`, [id], (err, paper) => {
        if (err || !paper) return res.status(404).json({ error: 'Question paper not found' });

        db.all(`SELECT q_no, section, question_text, option_a, option_b, option_c, option_d, correct_answer 
                FROM questions WHERE question_paper_id = ? ORDER BY q_no`, [id], (qErr, currentQuestions) => {
            if (qErr) return res.status(500).json({ error: qErr.message });

            const formattedCurrent = currentQuestions.map(q => ({
                qNo: q.q_no,
                section: q.section,
                question: q.question_text,
                options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
                answer: q.correct_answer
            }));

            const commonRmDeptId = (paper.campus_id === 1) ? 201 : ((paper.campus_id === 2) ? 202 : null);
            const isEt = (paper.department_id <= 9 || paper.department_id === 201 || paper.department_id === 202);

            let pqSql = `
                SELECT q.q_no, q.section, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer,
                       qp.set_name, qp.file_name, qp.department_id
                FROM questions q
                JOIN question_papers qp ON q.question_paper_id = qp.id
                WHERE (qp.department_id = ? ${isEt && commonRmDeptId ? `OR (qp.department_id = ${commonRmDeptId} AND q.section = 'A')` : ''})
                  AND qp.set_name NOT IN ('A', 'B')
            `;

            const oppSetName = (paper.set_name === 'A') ? 'B' : 'A';
            let oppSql = `
                SELECT q.q_no, q.section, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer,
                       qp.set_name, qp.file_name, qp.department_id
                FROM questions q
                JOIN question_papers qp ON q.question_paper_id = qp.id
                WHERE qp.department_id = ? AND qp.campus_id = ? AND qp.set_name = ?
            `;

            db.all(pqSql, [paper.department_id], (pqErr, pastQuestions) => {
                if (pqErr) return res.status(500).json({ error: pqErr.message });

                db.all(oppSql, [paper.department_id, paper.campus_id, oppSetName], (oppErr, oppQuestions) => {
                    const audit = performDuplicateAudit(formattedCurrent, pastQuestions || [], paper.set_name, oppQuestions || [], commonRmDeptId);

                    res.json({
                        success: true,
                        paper: {
                            id: paper.id,
                            set_name: paper.set_name,
                            file_name: paper.file_name,
                            department_name: paper.department_name,
                            campus_name: paper.campus_name,
                            total_questions: currentQuestions.length
                        },
                        totalQuestions: currentQuestions.length,
                        duplicateCount: audit.duplicateCount,
                        recycledCount: audit.recycledCount,
                        optionClonesCount: audit.optionClonesCount,
                        internalCount: audit.internalCount,
                        crossSetCount: audit.crossSetCount,
                        duplicates: audit.matchedDuplicates
                    });
                });
            });
        });
    });
});

// Helper: Common RM Department ID for Campus/Coordinator
function getCoordinatorCommonRmDeptId(user) {
    if (user.institution_id === 1 || user.campus_id === 1) return 201;
    if (user.institution_id === 5 || user.campus_id === 2) return 202;
    return null;
}

// Past Session Reference Papers for HOD
app.get('/api/hod/past-question-papers', requireAuth(['hod']), (req, res) => {
    const user = req.user;

    const sql = `
        SELECT 
            qp.id, 
            qp.department_id,
            d.name as dept_name,
            qp.campus_id,
            qp.set_name, 
            qp.file_name, 
            qp.file_path,
            qp.created_at,
            COUNT(q.id) as question_count
        FROM question_papers qp 
        JOIN departments d ON qp.department_id = d.id
        LEFT JOIN questions q ON qp.id = q.question_paper_id
        WHERE qp.department_id = ? AND qp.campus_id = ?
          AND qp.set_name NOT IN ('A', 'B')
        GROUP BY qp.id
        ORDER BY qp.set_name ASC
    `;

    db.all(sql, [user.department_id, user.campus_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const formatted = rows.map(r => {
            let sessionName = 'January 2026';
            let setLetter = 'Set A';
            if (r.set_name === 'JAN_A') { sessionName = 'January 2026'; setLetter = 'Set A'; }
            else if (r.set_name === 'JAN_B') { sessionName = 'January 2026'; setLetter = 'Set B'; }
            else if (r.set_name === 'JUL_A') { sessionName = 'July 2026'; setLetter = 'Set A'; }
            else if (r.set_name === 'JUL_B') { sessionName = 'July 2026'; setLetter = 'Set B'; }

            return {
                id: r.id,
                department_id: r.department_id,
                dept_name: r.dept_name,
                set_name: r.set_name,
                session_name: sessionName,
                set_letter: setLetter,
                file_name: r.file_name,
                category: 'Department Core',
                question_count: r.question_count,
                is_verified: r.question_count > 0,
                status_text: r.question_count > 0 
                    ? `✓ Properly Uploaded & Indexed (${r.question_count} MCQs active in duplicate check)` 
                    : `⚠️ Uploaded (0 MCQs parsed)`
            };
        });

        res.json({ pastPapers: formatted });
    });
});

app.get('/api/hod/past-question-papers/download', requireAuth(['hod', 'coordinator', 'admin', 'super_admin']), (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID is required' });

    db.get(`SELECT * FROM question_papers WHERE id = ?`, [id], (err, paper) => {
        if (err || !paper) return res.status(404).json({ error: 'Question paper not found' });
        
        if (req.user.role === 'hod') {
            const isOwnDept = paper.department_id === req.user.department_id;
            const isCommonRmForCampus = (paper.department_id === 201 && req.user.campus_id === 1) || 
                                        (paper.department_id === 202 && req.user.campus_id === 2);
            if (!isOwnDept && !isCommonRmForCampus) {
                return res.status(403).json({ error: 'Access denied: You do not have permission to download this paper.' });
            }
        }

        const candidatePaths = [
            path.join(__dirname, 'uploads', 'question_papers', path.basename(paper.file_path)),
            paper.file_path ? path.join(__dirname, paper.file_path.replace(/^\//, '')) : null,
            path.join(__dirname, 'uploads', path.basename(paper.file_path))
        ].filter(Boolean);

        let diskPath = null;
        for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
                diskPath = p;
                break;
            }
        }

        if (!diskPath) {
            // Fallback to Google Cloud Storage
            const gcsKey = `past_papers/${path.basename(paper.file_path)}`;
            return cloudStorage.getBufferFromCloudStorage(gcsKey)
                .then(buf => {
                    if (buf) {
                        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                        res.setHeader('Content-Disposition', `attachment; filename="${paper.file_name}"`);
                        return res.send(buf);
                    }
                    return res.status(404).json({ error: 'File not found on server or storage bucket' });
                })
                .catch(e => res.status(404).json({ error: 'File not found: ' + e.message }));
        }
        res.download(diskPath, paper.file_name);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH COORDINATOR ROUTES (COMMON RESEARCH METHODOLOGY)
// ─────────────────────────────────────────────────────────────────────────────

// Get Current Common RM Uploads for Coordinator
app.get('/api/coordinator/rm-question-papers', requireAuth(['coordinator', 'admin', 'super_admin']), (req, res) => {
    const user = req.user;
    const deptId = getCoordinatorCommonRmDeptId(user);
    if (!deptId) return res.status(400).json({ error: 'No Common Research Methodology department configured for your role.' });

    db.all(`SELECT id, set_name, file_name, file_path, created_at 
            FROM question_papers 
            WHERE department_id = ? AND set_name IN ('A', 'B')`,
        [deptId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ questionPapers: rows, deptId: deptId });
        }
    );
});

// Upload Common RM Question Paper (Set A or Set B)
app.post('/api/coordinator/upload-rm-question-paper', requireAuth(['coordinator', 'admin', 'super_admin']), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { set } = req.body;
    if (!set || !['A', 'B'].includes(set.toUpperCase())) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Invalid set option. Must be 'A' or 'B'." });
    }

    const setName = set.toUpperCase();
    const user = req.user;
    const deptId = getCoordinatorCommonRmDeptId(user);
    const campusId = (user.campus_id === 2 || user.institution_id === 5) ? 2 : 1;
    const campusCode = campusId === 2 ? 'TRY' : 'RMP';
    const deptCode = 'Common_RM';
    const session = 'Jan27';

    // Standard filename: RMP_Common_RM_A_Jan27.docx or TRY_Common_RM_B_Jan27.docx
    const standardFilename = `${campusCode}_Common_RM_${setName}_${session}.docx`;
    const organizedDir = path.join(__dirname, 'uploads', 'Jan27', campusCode, deptCode);
    if (!fs.existsSync(organizedDir)) {
        fs.mkdirSync(organizedDir, { recursive: true });
    }
    const organizedFilePath = path.join(organizedDir, standardFilename);
    const legacyPath = path.join(qpUploadDir, `${deptId}_${campusId}_${setName}.docx`);

    try {
        const parsedQuestions = parseQuestionPaperDocx(req.file.path);
        if (!parsedQuestions || parsedQuestions.length === 0) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: "Could not parse any MCQs from the question paper. Please ensure you are using the official DOCX template." });
        }

        // Fetch past Common RM questions for duplicate check
        db.all(`SELECT q.q_no, q.section, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer,
                       qp.set_name, qp.file_name, qp.department_id 
                FROM questions q 
                JOIN question_papers qp ON q.question_paper_id = qp.id 
                WHERE qp.department_id = ? AND qp.set_name NOT IN ('A', 'B')`,
            [deptId], (pqErr, pastQuestions) => {
                if (pqErr) {
                    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                    return res.status(500).json({ error: pqErr.message });
                }

                const oppSetName = (setName === 'A') ? 'B' : 'A';
                db.all(`SELECT q.q_no, q.section, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer,
                               qp.set_name, qp.file_name, qp.department_id
                        FROM questions q
                        JOIN question_papers qp ON q.question_paper_id = qp.id
                        WHERE qp.department_id = ? AND qp.campus_id = ? AND qp.set_name = ?`,
                    [deptId, campusId, oppSetName], (oppErr, oppQuestions) => {

                    const audit = performDuplicateAudit(parsedQuestions, pastQuestions, setName, oppQuestions || []);
                    const matchedDuplicates = audit.matchedDuplicates;
                    const duplicateCount = audit.duplicateCount;
                    const recycledCount = audit.recycledCount;
                    const internalCount = audit.internalCount;
                    const crossSetCount = audit.crossSetCount;

                    if (recycledCount > 10 || internalCount > 0 || crossSetCount > 0) {
                        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                        const reasons = [];
                        if (recycledCount > 10) {
                            reasons.push(`${recycledCount} questions recycled from past sessions (January/July 2026), exceeding the limit of 10`);
                        }
                        if (internalCount > 0) {
                            reasons.push(`${internalCount} internal duplicate question(s) repeated inside this same paper`);
                        }
                        if (crossSetCount > 0) {
                            reasons.push(`${crossSetCount} question(s) repeated across Set A and Set B`);
                        }
                        return res.status(400).json({ 
                            error: `Upload rejected: ${reasons.join('; ')}.`,
                            duplicateCount: duplicateCount,
                            recycledCount: recycledCount,
                            internalCount: internalCount,
                            crossSetCount: crossSetCount,
                            maxAllowed: 10,
                            duplicates: matchedDuplicates
                        });
                    }

                // Save file to organized directory & legacy path
                fs.copyFileSync(req.file.path, organizedFilePath);
                fs.copyFileSync(req.file.path, legacyPath);
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

                // Permanent Cloud Storage Bucket: Save/Overwrite in Google Cloud Storage
                const gcsKey = `Jan27/${campusCode}/${deptCode}/${standardFilename}`;
                cloudStorage.saveToCloudStorage(organizedFilePath, gcsKey).catch(e => console.warn('[Storage] GCS upload:', e.message));

                const relativeFilePath = `/uploads/Jan27/${campusCode}/${deptCode}/${standardFilename}`;
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    db.run(`INSERT OR REPLACE INTO question_papers 
                        (department_id, campus_id, set_name, file_name, file_path, uploaded_by) 
                        VALUES (?, ?, ?, ?, ?, ?)`,
                        [deptId, campusId, setName, standardFilename, relativeFilePath, user.id],
                        function(insQpErr) {
                            if (insQpErr) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ error: insQpErr.message });
                            }

                            const qpId = this.changes === 0 ? null : this.lastID;

                            const insertQuestions = (paperId) => {
                                db.run(`DELETE FROM questions WHERE question_paper_id = ?`, [paperId], (delErr) => {
                                    if (delErr) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ error: delErr.message });
                                    }

                                    const stmt = db.prepare(`INSERT INTO questions 
                                        (question_paper_id, section, q_no, question_text, option_a, option_b, option_c, option_d, correct_answer) 
                                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

                                    parsedQuestions.forEach(q => {
                                        stmt.run(paperId, q.section, q.qNo, q.question, q.options.A || '', q.options.B || '', q.options.C || '', q.options.D || '', q.answer || null);
                                    });

                                    stmt.finalize((finErr) => {
                                        if (finErr) {
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ error: finErr.message });
                                        }

                                        db.run('COMMIT', (commitErr) => {
                                            if (commitErr) return res.status(500).json({ error: commitErr.message });
                                            res.json({
                                                success: true,
                                                message: `Common Research Methodology Set ${setName} successfully validated and saved as "${standardFilename}". (${duplicateCount} repeated questions detected, allowed: ≤ 10).`,
                                                fileName: standardFilename,
                                                duplicateCount: duplicateCount,
                                                duplicates: matchedDuplicates,
                                                questionsParsedCount: parsedQuestions.length
                                            });
                                        });
                                    });
                                });
                            };

                            if (qpId) {
                                insertQuestions(qpId);
                            } else {
                                db.get(`SELECT id FROM question_papers WHERE department_id = ? AND campus_id = ? AND set_name = ?`,
                                    [deptId, campusId, setName], (selectErr, row) => {
                                        if (selectErr || !row) {
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ error: selectErr ? selectErr.message : "Error identifying paper ID" });
                                        }
                                        insertQuestions(row.id);
                                    });
                            }
                        }
                    );
                });
            });
        });
    } catch (parseErr) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: `DOCX Parsing Error: ${parseErr.message}` });
    }
});

// Delete Common RM Question Paper
app.delete('/api/coordinator/rm-question-paper/:id', requireAuth(['coordinator', 'admin', 'super_admin']), (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID is required' });

    db.get('SELECT * FROM question_papers WHERE id = ?', [id], (err, paper) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!paper) return res.status(404).json({ error: 'Question paper not found' });

        const deptId = getCoordinatorCommonRmDeptId(req.user);
        if (req.user.role === 'coordinator' && paper.department_id !== deptId) {
            return res.status(403).json({ error: 'Access denied: You can only delete Common RM papers for your faculty.' });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            db.run('DELETE FROM questions WHERE question_paper_id = ?', [id], (delQErr) => {
                if (delQErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: delQErr.message });
                }

                db.run('DELETE FROM question_papers WHERE id = ?', [id], function(delQPErr) {
                    if (delQPErr) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: delQPErr.message });
                    }

                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) return res.status(500).json({ error: commitErr.message });

                        if (paper.file_path) {
                            const diskPath = path.join(__dirname, paper.file_path.replace(/^\//, ''));
                            if (fs.existsSync(diskPath)) {
                                try { fs.unlinkSync(diskPath); } catch (e) {}
                            }
                            // Delete from Google Cloud Storage Bucket
                            const gcsKey = paper.file_path.replace(/^\/uploads\//, '');
                            cloudStorage.deleteFromCloudStorage(gcsKey).catch(e => console.warn('[Storage] GCS delete:', e.message));
                        }

                        res.json({ success: true, message: 'Question paper deleted successfully.' });
                    });
                });
            });
        });
    });
});

// Past Session Reference Papers for Coordinator
app.get('/api/coordinator/past-rm-question-papers', requireAuth(['coordinator', 'admin', 'super_admin']), (req, res) => {
    const user = req.user;
    const deptId = getCoordinatorCommonRmDeptId(user);
    if (!deptId) return res.status(400).json({ error: 'No Common RM department found.' });

    const sql = `
        SELECT 
            qp.id, 
            qp.department_id,
            d.name as dept_name,
            qp.campus_id,
            qp.set_name, 
            qp.file_name, 
            qp.file_path,
            qp.created_at,
            COUNT(q.id) as question_count
        FROM question_papers qp 
        JOIN departments d ON qp.department_id = d.id
        LEFT JOIN questions q ON qp.id = q.question_paper_id
        WHERE qp.department_id = ?
          AND qp.set_name NOT IN ('A', 'B')
        GROUP BY qp.id
        ORDER BY qp.set_name ASC
    `;

    db.all(sql, [deptId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const formatted = rows.map(r => {
            let sessionName = 'January 2026';
            let setLetter = 'Set A';
            if (r.set_name === 'JAN_A') { sessionName = 'January 2026'; setLetter = 'Set A'; }
            else if (r.set_name === 'JAN_B') { sessionName = 'January 2026'; setLetter = 'Set B'; }
            else if (r.set_name === 'JUL_A') { sessionName = 'July 2026'; setLetter = 'Set A'; }
            else if (r.set_name === 'JUL_B') { sessionName = 'July 2026'; setLetter = 'Set B'; }

            return {
                id: r.id,
                department_id: r.department_id,
                dept_name: r.dept_name,
                set_name: r.set_name,
                session_name: sessionName,
                set_letter: setLetter,
                file_name: r.file_name,
                category: 'Common Research Methodology',
                question_count: r.question_count,
                is_verified: r.question_count > 0,
                status_text: r.question_count > 0 
                    ? `✓ Properly Uploaded & Indexed (${r.question_count} MCQs active in duplicate check)` 
                    : `⚠️ Uploaded (0 MCQs parsed)`
            };
        });

        res.json({ pastPapers: formatted });
    });
});

// Coordinator: Tracker of Faculty Departments Status
app.get('/api/coordinator/faculty-departments-status', requireAuth(['coordinator', 'admin', 'super_admin']), (req, res) => {
    const user = req.user;
    const instId = user.institution_id;
    if (!instId) return res.status(400).json({ error: 'Coordinator institution not configured.' });

    const query = `
        SELECT 
            d.id as dept_id, 
            d.name as dept_name, 
            i.campus_id, 
            c.name as campus_name,
            qp.id as paper_id,
            qp.set_name,
            qp.file_name,
            qp.created_at
        FROM departments d
        JOIN institutions i ON d.institution_id = i.id
        JOIN campuses c ON i.campus_id = c.id
        LEFT JOIN question_papers qp ON qp.department_id = d.id AND qp.campus_id = c.id AND qp.set_name IN ('A', 'B')
        WHERE d.institution_id = ? AND d.id NOT IN (201, 202)
        ORDER BY d.name, qp.set_name
    `;

    db.all(query, [instId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const deptsMap = {};
        rows.forEach(r => {
            const key = `${r.dept_id}`;
            if (!deptsMap[key]) {
                deptsMap[key] = {
                    dept_id: r.dept_id,
                    dept_name: r.dept_name,
                    campus_id: r.campus_id,
                    campus_name: r.campus_name,
                    setA: null,
                    setB: null
                };
            }
            if (r.set_name === 'A') {
                deptsMap[key].setA = {
                    id: r.paper_id,
                    file_name: r.file_name,
                    uploaded_at: r.created_at
                };
            } else if (r.set_name === 'B') {
                deptsMap[key].setB = {
                    id: r.paper_id,
                    file_name: r.file_name,
                    uploaded_at: r.created_at
                };
            }
        });

        res.json({ departments: Object.values(deptsMap) });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES & GOOGLE DRIVE ZIP EXPORT
// ─────────────────────────────────────────────────────────────────────────────

// Admin Matrix Overview
app.get('/api/admin/question-papers', requireAuth(['admin', 'super_admin']), (req, res) => {
    const query = `
        SELECT 
            d.id as dept_id, 
            d.name as dept_name, 
            i.campus_id, 
            c.name as campus_name,
            qp.id as paper_id,
            qp.set_name,
            qp.file_name,
            qp.created_at
        FROM departments d
        JOIN institutions i ON d.institution_id = i.id
        JOIN campuses c ON i.campus_id = c.id
        LEFT JOIN question_papers qp ON qp.department_id = d.id AND qp.campus_id = c.id AND qp.set_name IN ('A', 'B')
        ORDER BY c.name, d.name
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const deptsMap = {};
        rows.forEach(r => {
            const key = `${r.dept_id}_${r.campus_id}`;
            if (!deptsMap[key]) {
                deptsMap[key] = {
                    dept_id: r.dept_id,
                    dept_name: r.dept_name,
                    campus_id: r.campus_id,
                    campus_name: r.campus_name,
                    setA: null,
                    setB: null
                };
            }
            if (r.set_name === 'A') {
                deptsMap[key].setA = {
                    id: r.paper_id,
                    file_name: r.file_name,
                    uploaded_at: r.created_at
                };
            } else if (r.set_name === 'B') {
                deptsMap[key].setB = {
                    id: r.paper_id,
                    file_name: r.file_name,
                    uploaded_at: r.created_at
                };
            }
        });

        res.json({ departments: Object.values(deptsMap) });
    });
});

// Admin 1-Click ZIP Export Structured for Google Drive
app.get('/api/admin/question-papers/export-drive-zip', requireAuth(['admin', 'super_admin']), (req, res) => {
    const session = 'Jan27';
    db.all(`
        SELECT qp.*, d.name as dept_name, c.name as campus_name
        FROM question_papers qp
        JOIN departments d ON qp.department_id = d.id
        JOIN campuses c ON qp.campus_id = c.id
        WHERE qp.set_name IN ('A', 'B')
        ORDER BY c.name, d.name, qp.set_name
    `, [], async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) {
            return res.status(400).json({ error: 'No Set A or Set B question papers uploaded yet.' });
        }

        try {
            const zip = new PizzaZip();
            let addedCount = 0;

            for (const paper of rows) {
                const campusCode = getCampusCode(paper.campus_name, paper.campus_id);
                const deptCode = getDepartmentCode(paper.dept_name);
                const standardFilename = `${campusCode}_${paper.set_name}_${deptCode}_${session}.docx`;

                const structuredPath = path.join(__dirname, 'uploads', 'Jan27', campusCode, deptCode, standardFilename);
                const legacyPath = path.join(__dirname, 'uploads', 'question_papers', `${paper.department_id}_${paper.campus_id}_${paper.set_name}.docx`);
                const directPath = paper.file_path ? path.join(__dirname, paper.file_path.replace(/^\//, '')) : null;

                let fileBuffer = null;
                if (fs.existsSync(structuredPath)) {
                    fileBuffer = fs.readFileSync(structuredPath);
                } else if (directPath && fs.existsSync(directPath)) {
                    fileBuffer = fs.readFileSync(directPath);
                } else if (fs.existsSync(legacyPath)) {
                    fileBuffer = fs.readFileSync(legacyPath);
                } else {
                    // Fallback to Google Cloud Storage permanent bucket
                    const gcsKey = `Jan27/${campusCode}/${deptCode}/${standardFilename}`;
                    fileBuffer = await cloudStorage.getBufferFromCloudStorage(gcsKey);
                }

                if (fileBuffer) {
                    const zipPath = `${session}/${campusCode}/${deptCode}/${standardFilename}`;
                    zip.file(zipPath, fileBuffer);
                    addedCount++;
                }
            }

            if (addedCount === 0) {
                return res.status(404).json({ error: 'Could not find physical question paper files on disk or in cloud bucket.' });
            }

            const zipBuffer = zip.generate({ type: 'nodebuffer' });
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename=PhD_Question_Papers_${session}_GoogleDrive.zip`);
            res.send(zipBuffer);
        } catch (zipErr) {
            console.error('Error generating Google Drive ZIP:', zipErr);
            res.status(500).json({ error: 'Failed to generate ZIP: ' + zipErr.message });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE PAST QUESTION PAPERS MANAGEMENT (ADMIN & HOD)
// ─────────────────────────────────────────────────────────────────────────────

// List all departments with detailed past paper statistics
app.get('/api/admin/departments/list-detailed', requireAuth(['admin', 'super_admin']), (req, res) => {
    const query = `
        SELECT 
            d.id as dept_id, 
            d.name as dept_name, 
            d.institution_id,
            i.name as inst_name,
            c.id as campus_id, 
            c.name as campus_name,
            COUNT(DISTINCT qp.id) as past_papers_count,
            COUNT(q.id) as total_past_questions
        FROM departments d
        JOIN institutions i ON d.institution_id = i.id
        JOIN campuses c ON i.campus_id = c.id
        LEFT JOIN question_papers qp ON qp.department_id = d.id AND qp.campus_id = c.id AND qp.set_name IN ('JAN_A', 'JAN_B', 'JUL_A', 'JUL_B')
        LEFT JOIN questions q ON q.question_paper_id = qp.id
        GROUP BY d.id, c.id
        ORDER BY c.name, d.name
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ departments: rows || [] });
    });
});

// Get all 4 reference baseline question papers for a specific department
app.get('/api/admin/departments/:id/past-papers', requireAuth(['admin', 'super_admin', 'hod']), (req, res) => {
    const deptId = parseInt(req.params.id);
    let campusId = req.query.campusId ? parseInt(req.query.campusId) : null;

    if (req.user.role === 'hod' && req.user.department_id !== deptId) {
        return res.status(403).json({ error: 'Access denied: You can only view past papers for your department.' });
    }

    db.get(`SELECT d.id, d.name as dept_name, d.institution_id, i.name as inst_name, c.id as campus_id, c.name as campus_name
            FROM departments d
            JOIN institutions i ON d.institution_id = i.id
            JOIN campuses c ON i.campus_id = c.id
            WHERE d.id = ? ${campusId ? 'AND c.id = ?' : ''}`,
        campusId ? [deptId, campusId] : [deptId],
        (dErr, deptInfo) => {
            if (dErr || !deptInfo) return res.status(404).json({ error: 'Department not found' });
            campusId = deptInfo.campus_id;

            const sql = `
                SELECT 
                    qp.id, 
                    qp.department_id, 
                    qp.campus_id, 
                    qp.set_name, 
                    qp.file_name, 
                    qp.file_path, 
                    qp.created_at,
                    COUNT(q.id) as question_count
                FROM question_papers qp
                LEFT JOIN questions q ON qp.id = q.question_paper_id
                WHERE qp.department_id = ? AND qp.campus_id = ? AND qp.set_name IN ('JAN_A', 'JAN_B', 'JUL_A', 'JUL_B')
                GROUP BY qp.id
            `;

            db.all(sql, [deptId, campusId], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });

                const slotsDef = [
                    { set_name: 'JAN_A', session: 'January 2026', set_letter: 'Set A', title: 'January 2026 — Set A' },
                    { set_name: 'JAN_B', session: 'January 2026', set_letter: 'Set B', title: 'January 2026 — Set B' },
                    { set_name: 'JUL_A', session: 'July 2026', set_letter: 'Set A', title: 'July 2026 — Set A' },
                    { set_name: 'JUL_B', session: 'July 2026', set_letter: 'Set B', title: 'July 2026 — Set B' }
                ];

                const rowMap = {};
                (rows || []).forEach(r => rowMap[r.set_name] = r);

                const pastPapers = slotsDef.map(slot => {
                    const existing = rowMap[slot.set_name];
                    return {
                        set_name: slot.set_name,
                        session: slot.session,
                        set_letter: slot.set_letter,
                        title: slot.title,
                        is_uploaded: !!existing,
                        id: existing ? existing.id : null,
                        file_name: existing ? existing.file_name : null,
                        file_path: existing ? existing.file_path : null,
                        question_count: existing ? existing.question_count : 0,
                        created_at: existing ? existing.created_at : null
                    };
                });

                res.json({ department: deptInfo, pastPapers });
            });
        }
    );
});

// Upload / Replace a reference baseline question paper for a department
app.post('/api/admin/departments/:deptId/past-paper/upload', requireAuth(['admin', 'super_admin', 'hod']), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const deptId = parseInt(req.params.deptId);
    const { set_name } = req.body;

    const validSets = ['JAN_A', 'JAN_B', 'JUL_A', 'JUL_B'];
    if (!set_name || !validSets.includes(set_name.toUpperCase())) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: `Invalid set name. Must be one of: ${validSets.join(', ')}` });
    }
    const setName = set_name.toUpperCase();

    if (req.user.role === 'hod' && req.user.department_id !== deptId) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Forbidden: HOD can only manage their own department past papers.' });
    }

    db.get(`SELECT d.id, d.name as dept_name, i.campus_id, c.name as campus_name
            FROM departments d
            JOIN institutions i ON d.institution_id = i.id
            JOIN campuses c ON i.campus_id = c.id
            WHERE d.id = ?`, [deptId], (dcErr, deptInfo) => {
        if (dcErr || !deptInfo) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Department not found' });
        }

        const campusId = deptInfo.campus_id;
        const filename = `past_${deptId}_${campusId}_${setName}.docx`;
        const destPath = path.join(qpUploadDir, filename);

        try {
            // Parse MCQs
            const parsedQuestions = parseQuestionPaperDocx(req.file.path);
            if (!parsedQuestions || parsedQuestions.length === 0) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ 
                    error: "Could not parse any MCQs from this question paper. Please ensure the DOCX file contains numbered questions and choices." 
                });
            }

            // Save file locally
            fs.copyFileSync(req.file.path, destPath);
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

            // Upload to Google Cloud Storage permanent bucket
            const gcsKey = `past_papers/${filename}`;
            cloudStorage.saveToCloudStorage(destPath, gcsKey).catch(e => console.warn('[Storage] Past paper GCS upload:', e.message));

            const relativeFilePath = `/uploads/question_papers/${filename}`;

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Check if existing paper row exists
                db.get(`SELECT id FROM question_papers WHERE department_id = ? AND campus_id = ? AND set_name = ?`,
                    [deptId, campusId, setName], (findErr, existingPaper) => {
                        if (findErr) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: findErr.message });
                        }

                        const afterPaperSaved = (paperId) => {
                            // Delete old questions
                            db.run(`DELETE FROM questions WHERE question_paper_id = ?`, [paperId], (delQErr) => {
                                if (delQErr) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: delQErr.message });
                                }

                                // Insert new questions
                                const stmt = db.prepare(`INSERT INTO questions 
                                    (question_paper_id, section, q_no, question_text, option_a, option_b, option_c, option_d, correct_answer) 
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

                                parsedQuestions.forEach(q => {
                                    stmt.run(paperId, q.section, q.qNo, q.question, q.options.A || '', q.options.B || '', q.options.C || '', q.options.D || '', q.answer || null);
                                });

                                stmt.finalize((finErr) => {
                                    if (finErr) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ error: finErr.message });
                                    }

                                    db.run('COMMIT', (commitErr) => {
                                        if (commitErr) return res.status(500).json({ error: commitErr.message });
                                        res.json({
                                            success: true,
                                            message: `Successfully uploaded and indexed ${parsedQuestions.length} MCQs for ${setName}!`,
                                            paperId: paperId,
                                            fileName: req.file.originalname,
                                            questionCount: parsedQuestions.length
                                        });
                                    });
                                });
                            });
                        };

                        if (existingPaper) {
                            db.run(`UPDATE question_papers 
                                    SET file_name = ?, file_path = ?, uploaded_by = ?, created_at = CURRENT_TIMESTAMP 
                                    WHERE id = ?`,
                                [req.file.originalname, relativeFilePath, req.user.id, existingPaper.id],
                                function(updErr) {
                                    if (updErr) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ error: updErr.message });
                                    }
                                    afterPaperSaved(existingPaper.id);
                                }
                            );
                        } else {
                            db.run(`INSERT INTO question_papers 
                                    (department_id, campus_id, set_name, file_name, file_path, uploaded_by) 
                                    VALUES (?, ?, ?, ?, ?, ?)`,
                                [deptId, campusId, setName, req.file.originalname, relativeFilePath, req.user.id],
                                function(insErr) {
                                    if (insErr) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ error: insErr.message });
                                    }
                                    afterPaperSaved(this.lastID);
                                }
                            );
                        }
                    }
                );
            });
        } catch (parseErr) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `DOCX Parsing Error: ${parseErr.message}` });
        }
    });
});

// Delete a reference baseline question paper
app.delete('/api/admin/past-paper/:id', requireAuth(['admin', 'super_admin', 'hod']), (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID is required' });

    db.get(`SELECT * FROM question_papers WHERE id = ?`, [id], (err, paper) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!paper) return res.status(404).json({ error: 'Question paper not found' });

        const validSets = ['JAN_A', 'JAN_B', 'JUL_A', 'JUL_B'];
        if (!validSets.includes(paper.set_name)) {
            return res.status(400).json({ error: 'This endpoint only deletes past reference question papers.' });
        }

        if (req.user.role === 'hod' && paper.department_id !== req.user.department_id) {
            return res.status(403).json({ error: 'Forbidden: HOD can only manage their own department past papers.' });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            db.run('DELETE FROM questions WHERE question_paper_id = ?', [id], (delQErr) => {
                if (delQErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: delQErr.message });
                }

                db.run('DELETE FROM question_papers WHERE id = ?', [id], function(delQpErr) {
                    if (delQpErr) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: delQpErr.message });
                    }

                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) return res.status(500).json({ error: commitErr.message });

                        if (paper.file_path) {
                            const diskPath = path.join(__dirname, paper.file_path.replace(/^\//, ''));
                            if (fs.existsSync(diskPath)) {
                                try { fs.unlinkSync(diskPath); } catch (e) {}
                            }
                            const gcsKey = `past_papers/${path.basename(paper.file_path)}`;
                            cloudStorage.deleteFromCloudStorage(gcsKey).catch(e => console.warn('[Storage] Past paper GCS delete:', e.message));
                        }

                        res.json({ success: true, message: `Reference question paper (${paper.set_name}) deleted successfully.` });
                    });
                });
            });
        });
    });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`==================================================================`);
    console.log(` SRMIST PhD Question Papers Portal (Dedicated App)`);
    console.log(` Running on Port: ${PORT}`);
    console.log(` Local URL:       http://localhost:${PORT}`);
    console.log(` Campus LAN URL:  http://10.11.58.24:${PORT}`);
    console.log(`==================================================================`);
});
