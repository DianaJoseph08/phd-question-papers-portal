# SRMIST Question Paper Office

Separate app for Ramapuram and Trichy PhD entrance question papers. The admissions app is retained as a copy in the parent directory. This app reads that copied admissions database and writes only its own `data` directory.

## Start

From this folder run `npm start`, then open http://127.0.0.1:3100. Dependencies are available from the copied parent codebase's `node_modules`. To move this app independently, run `npm install` and set `ADMISSIONS_DB` to an admissions database containing the campus, institution, department and user tables.

Use existing Admin, Super Admin or HoD credentials. Assigned research coordinators also have access to their Common RM categories. Other coordinators and deans do not have access. HoDs can access only their own department and campus; they cannot see other HoDs' upcoming papers. Administrators can view all papers. Login sessions expire after eight hours and reset on restart. Restart after changing account permissions in the admissions database.

The server binds to localhost by default. For a campus deployment, configure HTTPS through a reverse proxy, backups and a protected server. `HOST` and `PORT` configure the listener. Existing account passwords are checked against the copied admissions database using its existing password format.

## Workflow

1. Admin uploads/replaces the two January 2027 Word templates. The supplied files from `Question_Paper_Setting` are seeded on first start.
2. Admin uploads only past-session question papers (January and July 2026), or imports them from the local archive. Confirm the department/campus, session and set for each import because filenames are inconsistent. Archive documents remain downloadable even if their layout cannot be parsed into individual questions.
Administrators upload templates, review submissions and generate papers; they cannot upload January 2027 question papers.

3. HoDs download both templates and upload a January 2027 document for each set. Every upload is checked against readable questions from both past sessions across the matching department group in participating campuses. More than 10 matched uploaded questions rejects the upload without saving it. Exactly 10 is allowed and shown for review. Archives are available for their own campus department.
4. Admin opens each submission in the library, downloads its original Word file, checks all extracted questions and approves it. A full final paper contains 25 Research Methodology and 25 subject questions. Departments assigned Common RM can submit only 25 subject questions; the assigned coordinator supplies the RM section. They may also submit a complete 25 + 25 paper. Common RM coordinators submit 25 RM questions.
5. Admin generates Set A and Set B separately for a department. Shared departments receive exactly 25 questions from each campus (Research Methodology 13/12, subject 12/13). Departments offered at one campus automatically use that campus’s two sets. Both latest submissions must be approved for every participating campus; all source sets contribute. The matrix shows N/A for a campus where the department is absent.
6. Download the generated Word paper and the JSON source record. Inspect the Word layout before printing. Exact duplicate questions are excluded within a paper and against all earlier generated opposite-set papers. Conceptual repetition needs human review.

## Supported Word format and limitations

Keep `Research Methodology` and `Subject-Specific Questions` headings. A department-specific `Section B: Mathematics` (or another subject name) heading is also recognized. Each question must start with a typed number (for example 1. or 1)) or a top-level Word automatic decimal number. Question blocks extend to the next question number or section heading, independently of option labels. Automatic letter options remain attached to the question. Option-formatting differences do not block freshness screening; the administrator checks the original Word document during review. Section headings determine RM versus subject; missing headings produce an unspecified-section count. Numbered template placeholders do not qualify as a valid submission. Word equations and inline embedded images are preserved. External linked content and unsupported embedded objects are refused during generation. Complex tables, floating layouts and inherited source styles may need adjustment; always verify the final document in Word.

Mathematics combines Ramapuram FET, Ramapuram S&H and Trichy FET into one group, with 25 questions from Trichy and 25 from Ramapuram (13/12 across its two departments). Other generation groups use the institution category and department name to match campuses; Engineering and Science Biotechnology are separate. Unmatched or differently named departments require account mapping correction in the copied admissions database. There is no arbitrary combination of unrelated departments.

The initial templates contain a November 2026 date despite their January 2027 filenames. Upload corrected official templates before distribution. Generated papers are labelled January 2027 without an assumed exam date. The candidate paper removes bold formatting and the source answer-key section; use the original approved papers to check the key. A consolidated generated answer key is not yet provided.

View Word file opens/downloads the original document; Review submission shows the counts and screening report. Uploads are `.docx` only, up to 20 MB. Data is persistent in `data/papers.db` and `data/files`; back up both together. No email or external publishing is performed.

## Verification

Run `npm test` and `npm run test:integration`. The integration suite starts an isolated server with synthetic accounts and its own database; it does not change real papers. Tests cover extraction, equal campus distribution, insufficient/duplicate pools, single-campus generation and generated document content. Separate integration checks cover authentication, HoD isolation, templates, uploads, review and downloads.

## Freshness screening

Fresh, structurally valid papers are accepted when no repeats are detected. Up to 10 matched questions are accepted for review; more than 10 are rejected without saving. Missing, incomplete or unreadable archives produce an explicit coverage warning and do not block an upload. Only readable questions can be screened. Administrators must review those warnings before approval. Approval and generation repeat the check against the latest archive versions. Reports show the uploaded set, question number and text alongside the past session, campus, set, question number and text. Each uploaded question counts once even when it has multiple past matches.

Screening runs locally: it compares normalized question stems, word order and a conservative set of synonymous terms. Similarity of at least 80% flags a possible rephrasing; the score is not a probability. Changed numerical values and negation are treated separately. It cannot guarantee semantic equivalence, detect all rephrasings, or compare meaning in diagrams/equations. Human review remains necessary, especially for Tamil, Hindi and technical notation. No confidential exam content is sent to an external AI service.

## Research coordinator assignments

The separate question-paper app maps Ramapuram FET Common Research Methodology to Dr. Vani R (`vani`) and Trichy FET, FSH and FMHS Common Research Methodology to Dr. M. Infant Shyam Kumar (`infant`). Each faculty is a distinct category. These mappings are app-local; the admissions accounts and database are read-only. Only the assigned coordinator can submit that category, while admins upload its archives and templates and approve submissions. Common RM sets contain 25 numbered Research Methodology questions. FET common-paper generation alternates the 13/12 campus split between final sets. FSH/FMHS use the assigned campus’s two sets.

## Subject-only submissions and template checks

Ramapuram FET and Trichy FET/FSH/FMHS HoDs can submit 25 subject questions while their coordinator’s RM is pending. Structural validation checks numbered counts, section classification, A/B/C/D options and unfilled question placeholders. Unused RM placeholders in an otherwise complete subject section are ignored. The answer-key heading is checked with a review warning when absent. This is structural validation, not a font or page-layout comparison with the uploaded template. Generation requires both approved subject sets and, when needed, both approved Common RM sets for each campus/faculty. The source record identifies the actual coordinator paper supplying each RM question.

## Final 2026 import

`Question Papers 2026 Final-trichy.zip` is the authoritative revised source. `data/latest-archive-import/plan.json` and `results.json` record the mapping and all 156 imported current papers. Five revised Trichy documents replace earlier versions in the library. Trichy Mathematics January FINAL is Set A and SET2 is Set B. Occupational Therapy January RM and subject documents were combined into Set A. `Maths_QP_July_2026_S&H.docx` was deliberately excluded as requested. Previous versions remain stored; the library displays only the latest upload for each department/session/set.

`QUESTION_PAPER_DATA_DIR` can select a separate data directory for testing.
