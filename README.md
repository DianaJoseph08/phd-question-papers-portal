# SRMIST Question Paper Office

Separate app for Ramapuram and Trichy PhD entrance question papers. The admissions app is retained as a copy in the parent directory. This app reads that copied admissions database and writes only its own `data` directory.

## Start

From this folder run `npm start`, then open http://127.0.0.1:3100. Dependencies are available from the copied parent codebase's `node_modules`. To move this app independently, run `npm install` and set `ADMISSIONS_DB` to an admissions database containing the campus, institution, department and user tables.

Use existing Admin, Super Admin or HoD credentials. Assigned research coordinators also have access to their Common RM categories. Other coordinators, deans and other account holders can sign in to change their portal password only. HoDs can access only their own department and campus; they cannot see other HoDs' upcoming papers. Administrators can view all papers. Login sessions expire after eight hours and reset on restart. Restart after changing account permissions in the admissions database.

The server binds to localhost by default. For a campus deployment, configure HTTPS through a reverse proxy, backups and a protected server. `HOST` and `PORT` configure the listener. Existing account passwords are checked against the copied admissions database using its existing password format.

## Workflow

1. Admin uploads/replaces the two January 2027 Word templates. The supplied files from `Question_Paper_Setting` are seeded on first start.
2. Admin uploads only past-session question papers (January and July 2026), or imports them from the local archive. Confirm the department/campus, session and set for each import because filenames are inconsistent. Archive documents remain downloadable even if their layout cannot be parsed into individual questions.
Administrators upload templates, review submissions and generate papers; they cannot upload January 2027 question papers.

3. HoDs download both templates and upload a January 2027 document for each set. Every upload is checked against readable questions from both past sessions across the matching department group in participating campuses. More than 10 matched uploaded questions rejects the upload without saving it. Exactly 10 is allowed and shown for review. Archives are available for their own campus department.
4. Admin opens each submission in the library, downloads its original Word file, checks all extracted questions and approves it. A full final paper contains 25 Research Methodology and 25 subject questions. Departments assigned Common RM can submit only 25 subject questions; the assigned coordinator supplies the RM section. They may also submit a complete 25 + 25 paper. Common RM coordinators submit 25 RM questions.
5. Admin generates Set A and Set B separately for a department. Shared departments receive exactly 25 questions from each campus (Research Methodology 13/12, subject 12/13). Departments offered at one campus automatically use that campus’s two sets. Both latest submissions must be approved for every participating campus; all source sets contribute. The matrix shows N/A for a campus where the department is absent.
6. Download the generated Word paper and the JSON source record. Inspect the Word layout before printing. Exact duplicate questions are excluded within a paper and against all earlier generated opposite-set papers. Conceptual repetition needs human review.

## Adding departments

Suresh and Ruby can open **Departments** (also linked from **Upload papers**) and add a department under an existing campus faculty. The super administrator also has access. Choose an existing HoD account from that campus if the department needs January 2027 submissions. An unassigned department can still receive admin-uploaded January and July 2026 archives. An assigned HoD retains access to their existing department and gains access to the new one.

The new department appears in the archive/upload dropdowns, library filters and generation matrix. Common RM requirements follow its campus and faculty automatically. Use the same department name and faculty category across campuses to generate a shared paper; a department present at one campus uses that campus's two sets. Duplicate department names within the same faculty are refused. New department records and HoD assignments are stored in the question-paper database and restored from the storage bucket on restart; the original admissions accounts/database remain unchanged.

## Accounts and activity log

Every account holder has a **Change password** page. The username is immutable. A change requires the current password and a confirmed new password of 12–128 characters. The new password is stored as a salted scrypt hash in the question-paper database; the admissions database remains read-only. Subsequent portal logins use the changed password. A password change invalidates all other sessions, including sessions on another app instance.

Administrators have **User accounts** and **Activity log** pages. The account directory shows names, usernames, email addresses, campus, departments, roles and password status. Passwords and password hashes are never returned to the browser. An administrator can reset an account to a temporary password after confirming their own password. The user must change that temporary password before accessing papers. Only a super administrator can reset another super administrator's password.

The activity log records the actor, time in IST and relevant document/department details for uploads, replacements, rejected submissions, approvals, generation, department additions, template uploads, sign-ins/sign-outs and password changes/resets. It supports search, action filtering and pagination. Existing paper uploads and custom department additions receive historical entries using the recorded uploader and original timestamp. Actions before logging was introduced can only be reconstructed when that information was saved; passwords are never recorded in logs.

Administrators can **Remove** a paper from the library with a mandatory reason. It is then excluded from screening and generation, and an older version does not automatically become current. This is a recorded soft removal: the document and metadata remain stored for recovery/history. Other users cannot remove papers. Password changes, logs and removal metadata are included in the cloud database snapshot and preserved on restart/redeployment.

## Supported Word format and limitations

Keep `Research Methodology` and `Subject-Specific Questions` headings. A department-specific `Section B: Mathematics` (or another subject name) heading is also recognized, as is a standalone assigned department title such as `Chemistry Questions`. Question numbers in a table’s first column are recognized even when the text is in the next cell. Each question must start with a typed number (for example 1. or 1)) or a top-level Word automatic decimal number. Question blocks extend to the next question number or section heading, independently of option labels. Automatic letter options remain attached to the question. Option-formatting differences do not block freshness screening; the administrator checks the original Word document during review. Section headings determine RM versus subject; missing headings produce an unspecified-section count. Numbered template placeholders do not qualify as a valid submission. Word equations and inline embedded images are preserved. External linked content and unsupported embedded objects are refused during generation. Complex tables, floating layouts and inherited source styles may need adjustment; always verify the final document in Word.

Mathematics combines Ramapuram FET, Ramapuram S&H and Trichy FET into one group, with 25 questions from Trichy and 25 from Ramapuram (13/12 across its two departments). Other generation groups use the institution category and department name to match campuses; Engineering and Science Biotechnology are separate. Unmatched or differently named departments require account mapping correction in the copied admissions database. There is no arbitrary combination of unrelated departments.

The initial templates contain a November 2026 date despite their January 2027 filenames. Upload corrected official templates before distribution. Generated papers are labelled January 2027 without an assumed exam date. The candidate paper removes bold formatting and the source answer-key section; use the original approved papers to check the key. A consolidated generated answer key is not yet provided.

View Word file opens/downloads the original document; Review submission shows the counts and screening report. Uploads are `.docx` only, up to 20 MB. Data is persistent in `data/papers.db` and `data/files`; back up both together. No email or external publishing is performed.

## Verification

Run `npm test` and `npm run test:integration`. The integration suite starts an isolated server with synthetic accounts and its own database; it does not change real papers. Tests cover extraction, equal campus distribution, insufficient/duplicate pools, single-campus generation and generated document content. Separate integration checks cover authentication, HoD isolation, templates, uploads, review and downloads.

## Freshness screening

The same screening and submission rules apply to Ramapuram and Trichy, including all Trichy FET, FSH and FMHS Common RM assignments. Readable questions are screened before rejecting a count or section error; the response includes the match table and detected/expected counts together. Option-formatting diagnostics appear in a separate advisory remarks table after the repetition report. They do not block uploads or approval. The administrator’s review displays fresh diagnostics from the original Word file, including for older saved submissions. Fresh, structurally valid papers are accepted when no repeats are detected. Up to 10 matched questions are accepted for review; more than 10 are rejected without saving. Missing, incomplete or unreadable archives produce an explicit coverage warning and do not block an upload. Only readable questions can be screened. Administrators must review those warnings before approval. Approval and generation repeat the check against the latest archive versions. Reports show the uploaded set, question number and text alongside the past session, campus, set, question number and text. Each uploaded question counts once even when it has multiple past matches.

Screening runs locally: it compares normalized question stems, word order and a conservative set of synonymous terms. Similarity of at least 80% flags a possible rephrasing; the score is not a probability. Changed numerical values and negation are treated separately. It cannot guarantee semantic equivalence, detect all rephrasings, or compare meaning in diagrams/equations. Human review remains necessary, especially for Tamil, Hindi and technical notation. No confidential exam content is sent to an external AI service.

## Research coordinator assignments

The separate question-paper app maps Ramapuram FET Common Research Methodology to Dr. Vani R (`vani`) and Trichy FET, FSH and FMHS Common Research Methodology to Dr. M. Infant Shyam Kumar (`infant`). Each faculty is a distinct category. These mappings are app-local; the admissions accounts and database are read-only. Only the assigned coordinator can submit that category, while admins upload its archives and templates and approve submissions. Common RM sets contain 25 numbered Research Methodology questions. FET common-paper generation alternates the 13/12 campus split between final sets. FSH/FMHS use the assigned campus’s two sets.

## Subject-only submissions and template checks

Ramapuram FET and Trichy FET/FSH/FMHS HoDs can submit 25 subject questions while their coordinator’s RM is pending. Structural validation checks numbered counts, section classification and unfilled question placeholders. Option labels are nonblocking. Unused RM placeholders in an otherwise complete subject section are ignored. The answer-key heading is checked with a review warning when absent. This is structural validation, not a font or page-layout comparison with the uploaded template. Generation requires both approved subject sets and, when needed, both approved Common RM sets for each campus/faculty. The source record identifies the actual coordinator paper supplying each RM question.

## Final 2026 import

`Question Papers 2026 Final-trichy.zip` is the authoritative revised source. `data/latest-archive-import/plan.json` and `results.json` record the mapping and all 156 imported current papers. Five revised Trichy documents replace earlier versions in the library. Trichy Mathematics January FINAL is Set A and SET2 is Set B. Occupational Therapy January RM and subject documents were combined into Set A. `Maths_QP_July_2026_S&H.docx` was deliberately excluded as requested. Previous versions remain stored; the library displays only the latest upload for each department/session/set.

`QUESTION_PAPER_DATA_DIR` can select a separate data directory for testing.
