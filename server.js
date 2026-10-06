const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const PizzaZip = require('pizzip');

const app = express();
const PORT = process.env.PORT || 3001;

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

// DOCX MCQ Parser
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
                if (rText.length > 2) { 
                    boldRuns.push(rText);
                }
            }
        }

        paragraphs.push({
            text: text,
            numId: numId,
            fmt: fmt,
            boldRuns: boldRuns
        });
    });

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

        const manualMatch = p.match(/^\s*(\d+)[\.\s\)]+(.*)/);
        const isDecimalList = pObj.fmt === 'decimal';
        const isQuestion = manualMatch || isDecimalList;

        if (isQuestion) {
            let qNo = null;
            let qText = p;

            if (manualMatch) {
                qNo = parseInt(manualMatch[1], 10);
                qText = manualMatch[2].trim();
            }

            if (questions.length === 0 && qNo === 1 && qText.includes("compulsory")) continue;
            if (questions.length < 5 && (qText.includes("carry") || qText.includes("marking") || qText.includes("calculator"))) continue;

            let options = null;
            let boldRunsCombined = [...pObj.boldRuns];

            const inlineOptMatch = qText.match(/(.*?)\bA[\.\s\)]+(.*)\bB[\.\s\)]+(.*)\bC[\.\s\)]+(.*)\bD[\.\s\)]+(.*)/i);
            if (inlineOptMatch) {
                options = {
                    A: inlineOptMatch[2].trim(),
                    B: inlineOptMatch[3].trim(),
                    C: inlineOptMatch[4].trim(),
                    D: inlineOptMatch[5].trim()
                };
                qText = inlineOptMatch[1].trim();
            } else {
                let tempOptions = {};
                let foundOptionsCount = 0;
                let lookAheadIndex = i + 1;

                while (lookAheadIndex < paragraphs.length && foundOptionsCount < 4) {
                    const nextPObj = paragraphs[lookAheadIndex];
                    const nextP = nextPObj.text;

                    const nextManualMatch = nextP.match(/^\s*(\d+)[\.\s\)]+/);
                    const nextIsDecimalList = nextPObj.fmt === 'decimal';
                    if (nextManualMatch || nextIsDecimalList) {
                        break;
                    }

                    boldRunsCombined = boldRunsCombined.concat(nextPObj.boldRuns);

                    const optInlineMatch = nextP.match(/^\s*A[\.\s\)]+(.*)\bB[\.\s\)]+(.*)\bC[\.\s\)]+(.*)\bD[\.\s\)]+(.*)/i);
                    if (optInlineMatch) {
                        tempOptions.A = optInlineMatch[1].trim();
                        tempOptions.B = optInlineMatch[2].trim();
                        tempOptions.C = optInlineMatch[3].trim();
                        tempOptions.D = optInlineMatch[4].trim();
                        foundOptionsCount = 4;
                    } else {
                        const optMatch = nextP.match(/^\s*([A-D])[\.\s\)]+(.*)/i);
                        if (optMatch) {
                            const optLetter = optMatch[1].toUpperCase();
                            tempOptions[optLetter] = optMatch[2].trim();
                            foundOptionsCount++;
                        } else if (nextPObj.fmt === 'upperLetter' || nextPObj.fmt === 'lowerLetter') {
                            const letters = ['A', 'B', 'C', 'D'];
                            const letter = letters[foundOptionsCount];
                            tempOptions[letter] = nextP;
                            foundOptionsCount++;
                        }
                    }
                    lookAheadIndex++;
                }

                if (foundOptionsCount === 4) {
                    options = tempOptions;
                    i = lookAheadIndex - 1;
                }
            }

            if (options) {
                let correctOption = null;
                for (const letter of ['A', 'B', 'C', 'D']) {
                    if (!options[letter]) continue;
                    const optText = options[letter].toLowerCase().replace(/[^a-z0-9]/g, '');
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
                    options: options,
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
                SELECT q.q_no, q.section, q.question_text, qp.set_name, qp.file_name, qp.department_id 
                FROM questions q 
                JOIN question_papers qp ON q.question_paper_id = qp.id 
                JOIN departments d ON qp.department_id = d.id 
                WHERE (qp.department_id = ? ${isEtFaculty && commonRmDeptId ? `OR (qp.department_id = ${commonRmDeptId} AND q.section = 'A')` : ''})
                  AND qp.set_name NOT IN ('A', 'B')
            `;

            db.all(pqSql, [deptId], (pqErr, pastQuestions) => {
                    if (pqErr) {
                        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                        return res.status(500).json({ error: pqErr.message });
                    }

                    // Strict Duplicate Check
                    const cleanText = (txt) => (txt || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
                    const matchedDuplicates = [];

                    parsedQuestions.forEach(q => {
                        const qClean = cleanText(q.question);
                        if (!qClean || qClean.length < 5) return;

                        const match = (pastQuestions || []).find(pq => {
                            const pqClean = cleanText(pq.question_text);
                            return pqClean === qClean || 
                                   (qClean.length > 25 && pqClean.includes(qClean)) || 
                                   (pqClean.length > 25 && qClean.includes(pqClean));
                        });

                        if (match) {
                            let sessionName = 'Past Session';
                            let setNameFormatted = match.set_name;
                            if (match.set_name.startsWith('JAN')) {
                                sessionName = 'January 2026';
                                setNameFormatted = match.set_name.replace('JAN_', 'Set ');
                            } else if (match.set_name.startsWith('JUL')) {
                                sessionName = 'July 2026';
                                setNameFormatted = match.set_name.replace('JUL_', 'Set ');
                            }

                            if (match.department_id === commonRmDeptId) {
                                setNameFormatted += ' (Common RM)';
                            }

                            matchedDuplicates.push({
                                uploaded_set: setName,
                                uploaded_q_no: q.qNo,
                                uploaded_section: q.section,
                                matched_session: sessionName,
                                matched_set: setNameFormatted,
                                matched_q_no: match.q_no,
                                matched_section: match.section,
                                question_text: q.question
                            });
                        }
                    });

                    const duplicateCount = matchedDuplicates.length;

                    // If duplicate questions > 10: REJECT UPLOAD with full comparison table data
                    if (duplicateCount > 10) {
                        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                        return res.status(400).json({ 
                            error: `Upload rejected: Too many repeated questions. You have used ${duplicateCount} questions from the past two sessions (January/July 2026). A maximum of 10 repeated questions is allowed.`,
                            duplicateCount: duplicateCount,
                            maxAllowed: 10,
                            duplicates: matchedDuplicates
                        });
                    }

                    // Save file to organized directory & legacy path
                    fs.copyFileSync(req.file.path, organizedFilePath);
                    fs.copyFileSync(req.file.path, legacyPath);
                    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

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
        if (!diskPath) return res.status(404).json({ error: 'Physical file not found on server' });
        res.download(diskPath, paper.file_name);
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

        if (!diskPath) return res.status(404).json({ error: 'File not found on server' });
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
        db.all(`SELECT q.q_no, q.section, q.question_text, qp.set_name, qp.file_name 
                FROM questions q 
                JOIN question_papers qp ON q.question_paper_id = qp.id 
                WHERE qp.department_id = ? AND qp.set_name NOT IN ('A', 'B')`,
            [deptId], (pqErr, pastQuestions) => {
                if (pqErr) {
                    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                    return res.status(500).json({ error: pqErr.message });
                }

                const cleanText = (txt) => (txt || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
                const matchedDuplicates = [];

                parsedQuestions.forEach(q => {
                    const qClean = cleanText(q.question);
                    if (!qClean || qClean.length < 5) return;

                    const match = (pastQuestions || []).find(pq => {
                        const pqClean = cleanText(pq.question_text);
                        return pqClean === qClean || 
                               (qClean.length > 25 && pqClean.includes(qClean)) || 
                               (pqClean.length > 25 && qClean.includes(pqClean));
                    });

                    if (match) {
                        let sessionName = match.set_name.startsWith('JAN') ? 'January 2026' : (match.set_name.startsWith('JUL') ? 'July 2026' : 'Past Session');
                        let setNameFormatted = match.set_name.replace('JAN_', 'Set ').replace('JUL_', 'Set ');

                        matchedDuplicates.push({
                            uploaded_set: setName,
                            uploaded_q_no: q.qNo,
                            uploaded_section: q.section,
                            matched_session: sessionName,
                            matched_set: setNameFormatted,
                            matched_q_no: match.q_no,
                            matched_section: match.section,
                            question_text: q.question
                        });
                    }
                });

                const duplicateCount = matchedDuplicates.length;
                if (duplicateCount > 10) {
                    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                    return res.status(400).json({ 
                        error: `Upload rejected: Too many repeated questions. You have used ${duplicateCount} questions from the past two sessions (January/July 2026). A maximum of 10 repeated questions is allowed.`,
                        duplicateCount: duplicateCount,
                        maxAllowed: 10,
                        duplicates: matchedDuplicates
                    });
                }

                // Save file to organized directory & legacy path
                fs.copyFileSync(req.file.path, organizedFilePath);
                fs.copyFileSync(req.file.path, legacyPath);
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

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
            }
        );
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
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) {
            return res.status(400).json({ error: 'No Set A or Set B question papers uploaded yet.' });
        }

        try {
            const zip = new PizzaZip();
            let addedCount = 0;

            rows.forEach(paper => {
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
                }

                if (fileBuffer) {
                    const zipPath = `${session}/${campusCode}/${deptCode}/${standardFilename}`;
                    zip.file(zipPath, fileBuffer);
                    addedCount++;
                }
            });

            if (addedCount === 0) {
                return res.status(404).json({ error: 'Could not find physical question paper files on disk to package.' });
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

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`==================================================================`);
    console.log(` SRMIST PhD Question Papers Portal (Dedicated App)`);
    console.log(` Running on Port: ${PORT}`);
    console.log(` Local URL:       http://localhost:${PORT}`);
    console.log(` Campus LAN URL:  http://10.11.58.24:${PORT}`);
    console.log(`==================================================================`);
});
