// SRMIST PhD Question Papers Portal Client Script
const state = {
    token: localStorage.getItem('qp_token') || null,
    user: JSON.parse(localStorage.getItem('qp_user')) || null,
    hodPapers: [],
    pastPapers: [],
    adminDepts: [],
    currentDuplicates: [],
    currentFilterCampus: 'all',
    searchQuery: ''
};

// API Helper
async function api(url, method = 'GET', data = null, isMultipart = false) {
    const headers = {};
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }
    if (!isMultipart) {
        headers['Content-Type'] = 'application/json';
    }

    const options = { method, headers };
    if (data) {
        options.body = isMultipart ? data : JSON.stringify(data);
    }

    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    
    let result = null;
    if (contentType.includes('application/json')) {
        result = await res.json();
    } else {
        result = await res.text();
    }

    if (!res.ok) {
        const error = (result && result.error) ? result.error : `HTTP error ${res.status}`;
        const errObj = new Error(error);
        errObj.status = res.status;
        errObj.data = result;
        throw errObj;
    }

    return result;
}

// Toast Helper
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => {
        toast.className = 'toast';
    }, 4000);
}

// Download Helper with Authentication
async function downloadFileWithAuth(url, defaultFilename = 'Question_Paper.docx') {
    try {
        showToast('Preparing download...', 'info');
        const sep = url.includes('?') ? '&' : '?';
        const finalUrl = state.token ? `${url}${sep}token=${encodeURIComponent(state.token)}` : url;

        const res = await fetch(finalUrl, {
            headers: state.token ? { 'Authorization': `Bearer ${state.token}` } : {}
        });

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || `Download failed: HTTP ${res.status}`);
        }

        const blob = await res.blob();
        let filename = defaultFilename;
        const cd = res.headers.get('content-disposition');
        if (cd) {
            const match = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match && match[1]) {
                filename = match[1].replace(/['"]/g, '').trim();
            }
        }

        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            if (document.body.contains(a)) {
                document.body.removeChild(a);
            }
            window.URL.revokeObjectURL(blobUrl);
        }, 2000);
        showToast('Download started.', 'success');
    } catch (e) {
        showToast(e.message || 'Download failed', 'error');
    }
}

// Init App on Page Load
document.addEventListener('DOMContentLoaded', () => {
    initPortal();
});

async function initPortal() {
    if (!state.token || !state.user) {
        renderLoginView();
        return;
    }

    // Verify session
    try {
        const res = await api('/api/auth/me');
        state.user = res.user;
        localStorage.setItem('qp_user', JSON.stringify(res.user));
        updateUserNav();

        if (state.user.role === 'hod') {
            await renderHodView();
        } else if (state.user.role === 'coordinator') {
            await renderCoordinatorView();
        } else if (['admin', 'super_admin'].includes(state.user.role)) {
            await renderAdminView();
        } else {
            showToast('Access restricted: Role not recognized.', 'error');
            handleLogout();
        }
    } catch (e) {
        handleLogout();
    }
}

// Update Top Navigation
function updateUserNav() {
    const nav = document.getElementById('user-nav');
    const nameEl = document.getElementById('nav-user-name');
    const roleEl = document.getElementById('nav-user-role');
    if (nav && state.user) {
        nav.style.display = 'flex';
        nameEl.textContent = state.user.name;
        let roleDisplay = state.user.role === 'hod' ? 'HOD' : 
                          (state.user.role === 'coordinator' ? 'RESEARCH COORDINATOR' : state.user.role.toUpperCase());
        roleEl.textContent = roleDisplay.replace('_', ' ');
    }
}

// Auth Handlers
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const btn = document.getElementById('login-btn');

    if (!username || !password) {
        showToast('Please enter both username and password', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';

    try {
        const res = await api('/api/auth/login', 'POST', { username, password });
        state.token = res.token;
        state.user = res.user;
        localStorage.setItem('qp_token', res.token);
        localStorage.setItem('qp_user', JSON.stringify(res.user));

        showToast(`Welcome back, ${res.user.name}!`, 'success');
        updateUserNav();
        initPortal();
    } catch (err) {
        showToast(err.message || 'Login failed. Check username and password.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Sign In to Portal';
    }
}

function handleLogout() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('qp_token');
    localStorage.removeItem('qp_user');
    const nav = document.getElementById('user-nav');
    if (nav) nav.style.display = 'none';
    renderLoginView();
    showToast('Signed out successfully', 'info');
}

// View Switches
function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(sec => sec.style.display = 'none');
    const target = document.getElementById(viewId);
    if (target) target.style.display = 'block';
}

function renderLoginView() {
    switchView('view-login');
}

// ─────────────────────────────────────────────────────────────────────────────
// HOD VIEW
// ─────────────────────────────────────────────────────────────────────────────

async function renderHodView() {
    switchView('view-hod');

    // Fill Department Banner
    document.getElementById('hod-dept-name').textContent = state.user.department_name || 'Department';
    document.getElementById('hod-inst-name').innerHTML = `<i class="fa-solid fa-building-columns"></i> ${state.user.institution_name || 'Faculty'}`;
    document.getElementById('hod-campus-badge').textContent = state.user.campus_name || 'Campus';

    await loadHodPapers();
    await loadPastPapers();
}

async function loadHodPapers() {
    try {
        const res = await api('/api/hod/question-papers');
        state.hodPapers = res.questionPapers || [];
        renderUploadSlots();
    } catch (e) {
        showToast(`Failed to load uploaded papers: ${e.message}`, 'error');
    }
}

function renderUploadSlots() {
    renderSlot('A');
    renderSlot('B');
}

function renderSlot(setLetter) {
    const paper = state.hodPapers.find(p => p.set_name === setLetter);
    const bodyEl = document.getElementById(`body-set-${setLetter.toLowerCase()}`);
    const badgeEl = document.getElementById(`status-badge-${setLetter.toLowerCase()}`);

    if (!bodyEl || !badgeEl) return;

    if (paper) {
        badgeEl.textContent = 'Uploaded & Validated';
        badgeEl.className = 'status-badge uploaded';

        const uploadDate = new Date(paper.created_at).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        bodyEl.innerHTML = `
            <div class="uploaded-box">
                <div class="uploaded-info">
                    <div class="docx-icon"><i class="fa-solid fa-file-word"></i></div>
                    <div class="file-details">
                        <h5>${escapeHtml(paper.file_name)}</h5>
                        <div class="file-meta">
                            <span><i class="fa-regular fa-clock"></i> Uploaded: ${uploadDate}</span>
                            <span class="badge-tag passed"><i class="fa-solid fa-check-double"></i> ≤ 10 Duplicates Passed</span>
                        </div>
                    </div>
                </div>
                <div class="uploaded-actions">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="downloadFileWithAuth('/api/question-papers/download/${paper.id}', '${escapeHtml(paper.file_name)}')">
                        <i class="fa-solid fa-download"></i> Download Submitted DOCX
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="viewAuditReport(${paper.id}, '${setLetter}')" style="background: #eef2ff; color: #4338ca; border-color: #c7d2fe;">
                        <i class="fa-solid fa-magnifying-glass-chart"></i> View Similarity Report
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteQuestionPaper(${paper.id}, '${setLetter}')">
                        <i class="fa-solid fa-trash-can"></i> Delete & Re-upload
                    </button>
                </div>
            </div>
        `;
    } else {
        badgeEl.textContent = 'Not Uploaded';
        badgeEl.className = 'status-badge pending';

        bodyEl.innerHTML = `
            <div class="dropzone" id="dropzone-${setLetter}" 
                 onclick="triggerFileInput('${setLetter}')"
                 ondragover="handleDragOver(event, '${setLetter}')"
                 ondragleave="handleDragLeave(event, '${setLetter}')"
                 ondrop="handleDrop(event, '${setLetter}')">
                <div class="dropzone-icon">
                    <i class="fa-solid fa-cloud-arrow-up"></i>
                </div>
                <div class="dropzone-text">
                    <h5>Click or Drag & Drop Set ${setLetter} Question Paper</h5>
                    <p>Supported format: Official DOCX Template (50 MCQs)</p>
                </div>
                <input type="file" id="file-input-${setLetter}" accept=".docx" style="display: none;" onchange="handleFileSelected(event, '${setLetter}')">
                <div style="margin-top: 1rem; display: flex; justify-content: center; gap: 0.5rem; flex-wrap: wrap;">
                    <a href="/templates/SRMIST_PhD_QP_Template_Set_${setLetter}_Jan2027.docx" download="SRMIST_PhD_QP_Template_Set_${setLetter}_Jan2027.docx" class="btn btn-secondary btn-sm" onclick="event.stopPropagation();">
                        <i class="fa-solid fa-file-word"></i> Download Set ${setLetter} Template
                    </a>
                    <button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation(); triggerFileInput('${setLetter}');">
                        <i class="fa-solid fa-folder-open"></i> Upload Set ${setLetter} (.docx)
                    </button>
                </div>
            </div>
        `;
    }
}

function triggerFileInput(setLetter) {
    const input = document.getElementById(`file-input-${setLetter}`);
    if (input) input.click();
}

function handleDragOver(e, setLetter) {
    e.preventDefault();
    const zone = document.getElementById(`dropzone-${setLetter}`);
    if (zone) zone.classList.add('dragover');
}

function handleDragLeave(e, setLetter) {
    e.preventDefault();
    const zone = document.getElementById(`dropzone-${setLetter}`);
    if (zone) zone.classList.remove('dragover');
}

function handleDrop(e, setLetter) {
    e.preventDefault();
    const zone = document.getElementById(`dropzone-${setLetter}`);
    if (zone) zone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        uploadFile(e.dataTransfer.files[0], setLetter);
    }
}

function handleFileSelected(e, setLetter) {
    if (e.target.files && e.target.files[0]) {
        uploadFile(e.target.files[0], setLetter);
    }
}

// Upload & Process Question Paper File
async function uploadFile(file, setLetter) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
        showToast('Invalid file format. Please upload a Word document (.docx).', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('set', setLetter);
    formData.append('file', file);

    showToast(`Analyzing Set ${setLetter}... checking for duplicate questions against past sessions...`, 'info');

    try {
        const res = await api('/api/hod/upload-question-paper', 'POST', formData, true);
        showToast(res.message || `Set ${setLetter} uploaded and verified successfully!`, 'success');
        await loadHodPapers();
    } catch (err) {
        if (err.data && err.data.duplicates && err.data.duplicateCount > 10) {
            // SHOW REJECTION MODAL WITH COMPARISON TABLE
            openDuplicateModal(setLetter, err.data);
        } else {
            showToast(err.message || 'Upload failed', 'error');
        }
    }
}

// Delete Question Paper
async function deleteQuestionPaper(id, setLetter) {
    if (!confirm(`Are you sure you want to delete Set ${setLetter}? You will need to upload a revised DOCX file.`)) return;

    try {
        await api(`/api/question-papers/${id}`, 'DELETE');
        showToast(`Set ${setLetter} deleted. You can now upload a revised paper.`, 'info');
        await loadHodPapers();
    } catch (e) {
        showToast(`Delete failed: ${e.message}`, 'error');
    }
}

// Load Past Reference Question Papers (Table / List View)
async function loadPastPapers() {
    const tbody = document.getElementById('past-papers-tbody');
    const summaryCountEl = document.getElementById('past-papers-summary-count');

    if (!tbody) return;

    try {
        const res = await api('/api/hod/past-question-papers');
        state.pastPapers = res.pastPapers || [];

        if (summaryCountEl) {
            summaryCountEl.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${state.pastPapers.length} Papers Active in Duplicate System`;
        }

        if (state.pastPapers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding: 2rem; color: var(--text-muted);">No reference question papers found for this department.</td></tr>`;
            return;
        }

        tbody.innerHTML = state.pastPapers.map(p => {
            const statusBadge = p.is_verified
                ? `<span class="status-pill-success"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(p.status_text)}</span>`
                : `<span class="status-pill-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(p.status_text)}</span>`;

            return `
                <tr>
                    <td>
                        <span class="badge-session"><i class="fa-regular fa-calendar-days"></i> ${escapeHtml(p.session_name)} &bull; ${escapeHtml(p.set_letter)}</span>
                    </td>
                    <td>
                        <div class="file-name-cell">
                            <i class="fa-solid fa-file-word"></i>
                            <span>${escapeHtml(p.file_name)}</span>
                        </div>
                    </td>
                    <td>${statusBadge}</td>
                    <td style="text-align: center; white-space: nowrap;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="downloadFileWithAuth('/api/hod/past-question-papers/download?id=${p.id}', '${escapeHtml(p.file_name)}')">
                            <i class="fa-solid fa-download"></i> Download
                        </button>
                        <button type="button" class="btn btn-danger btn-sm" onclick="deletePastPaperAction(${p.id}, '${p.set_name}', '${escapeHtml(p.session_name)} ${escapeHtml(p.set_letter)}')" style="margin-left: 4px;">
                            <i class="fa-solid fa-trash-can"></i> Delete
                        </button>
                        <button type="button" class="btn btn-primary btn-sm" onclick="openPastPapersModal()" style="margin-left: 4px;">
                            <i class="fa-solid fa-arrows-rotate"></i> Replace
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color: #ef4444; padding: 1.5rem;">Error loading past question papers: ${escapeHtml(e.message)}</td></tr>`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH COORDINATOR VIEW (COMMON RESEARCH METHODOLOGY)
// ─────────────────────────────────────────────────────────────────────────────

async function renderCoordinatorView() {
    switchView('view-coordinator');

    document.getElementById('coord-name').textContent = state.user.name || 'Research Coordinator';
    document.getElementById('coord-inst-name').innerHTML = `<i class="fa-solid fa-building-columns"></i> Faculty Research Coordinator &bull; ${state.user.institution_name || 'Faculty of Engineering and Technology'}`;
    document.getElementById('coord-campus-badge').textContent = state.user.campus_name || 'Campus';

    await loadCoordinatorRmPapers();
    await loadCoordinatorPastPapers();
    await loadCoordinatorFacultyStatus();
}

async function loadCoordinatorRmPapers() {
    try {
        const res = await api('/api/coordinator/rm-question-papers');
        state.coordPapers = res.questionPapers || [];
        renderCoordinatorSlots();
    } catch (e) {
        showToast(`Failed to load Common RM papers: ${e.message}`, 'error');
    }
}

function renderCoordinatorSlots() {
    renderCoordinatorSlot('A');
    renderCoordinatorSlot('B');
}

function renderCoordinatorSlot(setLetter) {
    const paper = (state.coordPapers || []).find(p => p.set_name === setLetter);
    const bodyEl = document.getElementById(`coord-body-set-${setLetter.toLowerCase()}`);
    const badgeEl = document.getElementById(`coord-status-badge-${setLetter.toLowerCase()}`);

    if (!bodyEl || !badgeEl) return;

    if (paper) {
        badgeEl.textContent = 'Uploaded & Validated';
        badgeEl.className = 'status-badge uploaded';

        const uploadDate = new Date(paper.created_at).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        bodyEl.innerHTML = `
            <div class="uploaded-box">
                <div class="uploaded-info">
                    <div class="docx-icon"><i class="fa-solid fa-file-word"></i></div>
                    <div class="file-details">
                        <h5>${escapeHtml(paper.file_name)}</h5>
                        <div class="file-meta">
                            <span><i class="fa-regular fa-clock"></i> Uploaded: ${uploadDate}</span>
                            <span class="badge-tag passed"><i class="fa-solid fa-check-double"></i> ≤ 10 Duplicates Passed</span>
                        </div>
                    </div>
                </div>
                <div class="uploaded-actions">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="downloadFileWithAuth('/api/question-papers/download/${paper.id}', '${escapeHtml(paper.file_name)}')">
                        <i class="fa-solid fa-download"></i> Download Submitted DOCX
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="viewAuditReport(${paper.id}, '${setLetter}')" style="background: #eef2ff; color: #4338ca; border-color: #c7d2fe;">
                        <i class="fa-solid fa-magnifying-glass-chart"></i> View Similarity Report
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteCoordinatorRmPaper(${paper.id}, '${setLetter}')">
                        <i class="fa-solid fa-trash-can"></i> Delete & Re-upload
                    </button>
                </div>
            </div>
        `;
    } else {
        badgeEl.textContent = 'Not Uploaded';
        badgeEl.className = 'status-badge pending';

        bodyEl.innerHTML = `
            <div class="dropzone" id="coord-dropzone-${setLetter}" 
                 onclick="triggerCoordinatorFileInput('${setLetter}')"
                 ondragover="handleCoordinatorDragOver(event, '${setLetter}')"
                 ondragleave="handleCoordinatorDragLeave(event, '${setLetter}')"
                 ondrop="handleCoordinatorDrop(event, '${setLetter}')">
                <div class="dropzone-icon">
                    <i class="fa-solid fa-cloud-arrow-up"></i>
                </div>
                <div class="dropzone-text">
                    <h5>Click or Drag & Drop Common RM Set ${setLetter}</h5>
                    <p>Supported format: Official DOCX Template (Section A - 25 MCQs)</p>
                </div>
                <input type="file" id="coord-file-input-${setLetter}" accept=".docx" style="display: none;" onchange="handleCoordinatorFileSelected(event, '${setLetter}')">
                <div style="margin-top: 1rem; display: flex; justify-content: center; gap: 0.5rem; flex-wrap: wrap;">
                    <a href="/templates/SRMIST_PhD_QP_Template_Set_${setLetter}_Jan2027.docx" download="SRMIST_PhD_QP_Template_Set_${setLetter}_Jan2027.docx" class="btn btn-secondary btn-sm" onclick="event.stopPropagation();">
                        <i class="fa-solid fa-file-word"></i> Download Set ${setLetter} Template
                    </a>
                    <button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation(); triggerCoordinatorFileInput('${setLetter}');">
                        <i class="fa-solid fa-folder-open"></i> Upload Set ${setLetter} (.docx)
                    </button>
                </div>
            </div>
        `;
    }
}

function triggerCoordinatorFileInput(setLetter) {
    const input = document.getElementById(`coord-file-input-${setLetter}`);
    if (input) input.click();
}

function handleCoordinatorDragOver(e, setLetter) {
    e.preventDefault();
    const zone = document.getElementById(`coord-dropzone-${setLetter}`);
    if (zone) zone.classList.add('dragover');
}

function handleCoordinatorDragLeave(e, setLetter) {
    e.preventDefault();
    const zone = document.getElementById(`coord-dropzone-${setLetter}`);
    if (zone) zone.classList.remove('dragover');
}

function handleCoordinatorDrop(e, setLetter) {
    e.preventDefault();
    const zone = document.getElementById(`coord-dropzone-${setLetter}`);
    if (zone) zone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        uploadCoordinatorRmFile(e.dataTransfer.files[0], setLetter);
    }
}

function handleCoordinatorFileSelected(e, setLetter) {
    if (e.target.files && e.target.files[0]) {
        uploadCoordinatorRmFile(e.target.files[0], setLetter);
    }
}

async function uploadCoordinatorRmFile(file, setLetter) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
        showToast('Invalid file format. Please upload a Word document (.docx).', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('set', setLetter);
    formData.append('file', file);

    showToast(`Analyzing Common RM Set ${setLetter}... checking duplicates...`, 'info');

    try {
        const res = await api('/api/coordinator/upload-rm-question-paper', 'POST', formData, true);
        showToast(res.message || `Common RM Set ${setLetter} uploaded successfully!`, 'success');
        await loadCoordinatorRmPapers();
    } catch (err) {
        if (err.data && err.data.duplicates && err.data.duplicateCount > 10) {
            openDuplicateModal(setLetter, err.data);
        } else {
            showToast(err.message || 'Upload failed', 'error');
        }
    }
}

async function deleteCoordinatorRmPaper(id, setLetter) {
    if (!confirm(`Are you sure you want to delete Common RM Set ${setLetter}? You will need to re-upload.`)) return;

    try {
        await api(`/api/coordinator/rm-question-paper/${id}`, 'DELETE');
        showToast(`Set ${setLetter} deleted successfully.`, 'info');
        await loadCoordinatorRmPapers();
    } catch (e) {
        showToast(`Delete failed: ${e.message}`, 'error');
    }
}

async function loadCoordinatorPastPapers() {
    const tbody = document.getElementById('coord-past-papers-tbody');
    if (!tbody) return;

    try {
        const res = await api('/api/coordinator/past-rm-question-papers');
        const pastPapers = res.pastPapers || [];

        if (pastPapers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 2rem; color: var(--text-muted);">No past reference papers found.</td></tr>`;
            return;
        }

        tbody.innerHTML = pastPapers.map(p => {
            return `
                <tr>
                    <td>
                        <span class="badge-session"><i class="fa-regular fa-calendar-days"></i> ${escapeHtml(p.session_name)} &bull; ${escapeHtml(p.set_letter)}</span>
                    </td>
                    <td><span class="badge-category-rm"><i class="fa-solid fa-book-bookmark"></i> Common RM</span></td>
                    <td>
                        <div class="file-name-cell">
                            <i class="fa-solid fa-file-word"></i>
                            <span>${escapeHtml(p.file_name)}</span>
                        </div>
                    </td>
                    <td>
                        <span class="status-pill-success"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(p.status_text)}</span>
                    </td>
                    <td style="text-align: center;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="downloadFileWithAuth('/api/hod/past-question-papers/download?id=${p.id}', '${escapeHtml(p.file_name)}')">
                            <i class="fa-solid fa-download"></i> Download (.docx)
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color: #ef4444; padding: 1.5rem;">Error loading past Common RM papers.</td></tr>`;
    }
}

async function loadCoordinatorFacultyStatus() {
    const tbody = document.getElementById('coord-dept-status-tbody');
    if (!tbody) return;

    try {
        const res = await api('/api/coordinator/faculty-departments-status');
        const depts = res.departments || [];

        if (depts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 2rem; color: var(--text-muted);">No departments found for this faculty.</td></tr>`;
            return;
        }

        tbody.innerHTML = depts.map(d => {
            const setAHtml = d.setA ? `
                <span class="badge-tag" style="background:#dcfce7; color:#15803d; margin-bottom:4px;">
                    <i class="fa-solid fa-check"></i> Uploaded
                </span><br>
                <a href="javascript:void(0)" onclick="downloadFileWithAuth('/api/question-papers/download/${d.setA.id}', '${escapeHtml(d.setA.file_name)}')" style="font-size: 0.75rem; color: var(--primary); text-decoration: underline;">
                    ${escapeHtml(d.setA.file_name)}
                </a>
            ` : `<span class="badge-tag" style="background:#fee2e2; color:#b91c1c;"><i class="fa-solid fa-xmark"></i> Pending</span>`;

            const setBHtml = d.setB ? `
                <span class="badge-tag" style="background:#dcfce7; color:#15803d; margin-bottom:4px;">
                    <i class="fa-solid fa-check"></i> Uploaded
                </span><br>
                <a href="javascript:void(0)" onclick="downloadFileWithAuth('/api/question-papers/download/${d.setB.id}', '${escapeHtml(d.setB.file_name)}')" style="font-size: 0.75rem; color: var(--primary); text-decoration: underline;">
                    ${escapeHtml(d.setB.file_name)}
                </a>
            ` : `<span class="badge-tag" style="background:#fee2e2; color:#b91c1c;"><i class="fa-solid fa-xmark"></i> Pending</span>`;

            let statusBadge = '';
            if (d.setA && d.setB) {
                statusBadge = `<span class="badge-tag" style="background:#dcfce7; color:#15803d; font-size:0.8rem; padding: 4px 10px;"><i class="fa-solid fa-circle-check"></i> Complete</span>`;
            } else if (d.setA || d.setB) {
                statusBadge = `<span class="badge-tag" style="background:#fef3c7; color:#b45309; font-size:0.8rem; padding: 4px 10px;"><i class="fa-solid fa-clock"></i> Partially Submitted</span>`;
            } else {
                statusBadge = `<span class="badge-tag" style="background:#f1f5f9; color:#64748b; font-size:0.8rem; padding: 4px 10px;"><i class="fa-solid fa-circle-minus"></i> Not Started</span>`;
            }

            return `
                <tr>
                    <td><strong>${escapeHtml(d.dept_name)}</strong></td>
                    <td><span class="campus-badge" style="background:#e2e8f0; color:#334155;">${escapeHtml(d.campus_name)}</span></td>
                    <td>${setAHtml}</td>
                    <td>${setBHtml}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color: #ef4444; padding: 1.5rem;">Error loading department statuses.</td></tr>`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// REJECTION MODAL & COMPARISON TABLE
// ─────────────────────────────────────────────────────────────────────────────

async function viewAuditReport(paperId, setLetter) {
    showToast(`Generating Similarity & Integrity Audit Report for Set ${setLetter}...`, 'info');
    try {
        const res = await apiRequest(`/api/question-papers/${paperId}/audit-report`);
        if (res && res.success) {
            openDuplicateModal(setLetter, res, true);
        } else {
            showToast(res.error || 'Failed to generate audit report', 'error');
        }
    } catch (e) {
        showToast('Error loading audit report: ' + e.message, 'error');
    }
}

function openDuplicateModal(setLetter, data, isAuditView = false) {
    state.currentAuditData = data;
    state.currentAuditSetLetter = setLetter;
    state.currentAuditIsView = isAuditView;
    state.currentDuplicates = data.duplicates || [];
    state.auditViewFilter = (state.currentDuplicates.length > 0) ? 'flagged' : 'all';

    const modal = document.getElementById('duplicate-modal');
    const titleEl = document.getElementById('modal-title');
    const subtitleEl = document.getElementById('modal-subtitle');
    const summaryEl = document.getElementById('modal-summary-text');
    const alertBox = document.getElementById('modal-alert-box');
    const flaggedCountEl = document.getElementById('flagged-count');
    const allQuestionsCountEl = document.getElementById('all-questions-count');

    const totalQuestions = data.totalQuestions || (data.paper ? data.paper.total_questions : (data.allQuestions ? data.allQuestions.length : 50));
    const recycledCount = data.recycledCount !== undefined ? data.recycledCount : (data.duplicates ? data.duplicates.filter(d => d.category === 'PAST_RECYCLED').length : 0);
    const optionClonesCount = data.optionClonesCount !== undefined ? data.optionClonesCount : (data.duplicates ? data.duplicates.filter(d => (d.match_type || '').includes('Options')).length : 0);
    const internalCount = data.internalCount !== undefined ? data.internalCount : (data.duplicates ? data.duplicates.filter(d => d.category === 'INTERNAL_REPEAT').length : 0);
    const crossSetCount = data.crossSetCount !== undefined ? data.crossSetCount : (data.duplicates ? data.duplicates.filter(d => d.category === 'CROSS_SET').length : 0);
    const duplicateCount = data.duplicateCount !== undefined ? data.duplicateCount : (data.duplicates ? data.duplicates.length : 0);

    if (flaggedCountEl) flaggedCountEl.textContent = duplicateCount;
    if (allQuestionsCountEl) allQuestionsCountEl.textContent = totalQuestions;

    if (isAuditView) {
        titleEl.textContent = `Question Paper Similarity & Integrity Audit: Set ${setLetter}`;
        subtitleEl.textContent = `Comprehensive comparison against reference session papers`;

        if (duplicateCount === 0) {
            alertBox.className = 'alert-box alert-success';
            summaryEl.innerHTML = `<span style="color:#15803d;"><i class="fa-solid fa-circle-check"></i> <strong>Integrity Verified: Clean & Original.</strong> No recycled past questions or duplicate choices detected across all ${totalQuestions} questions.</span>`;
        } else {
            alertBox.className = 'alert-box alert-danger';
            summaryEl.innerHTML = `
                <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:2px;">
                    <span class="badge-tag" style="background:#fee2e2; color:#991b1b; padding:4px 10px; font-size:0.85rem;"><i class="fa-solid fa-recycle"></i> ${recycledCount} Recycled Questions</span>
                    <span class="badge-tag" style="background:#ffedd5; color:#9a3412; padding:4px 10px; font-size:0.85rem;"><i class="fa-solid fa-list-check"></i> ${optionClonesCount} Option Clones</span>
                    ${internalCount > 0 ? `<span class="badge-tag" style="background:#f3e8ff; color:#6b21a8; padding:4px 10px; font-size:0.85rem;"><i class="fa-solid fa-arrows-rotate"></i> ${internalCount} Internal Repeats</span>` : ''}
                    ${crossSetCount > 0 ? `<span class="badge-tag" style="background:#e0e7ff; color:#3730a3; padding:4px 10px; font-size:0.85rem;"><i class="fa-solid fa-shuffle"></i> ${crossSetCount} Cross-Set Duplicates</span>` : ''}
                </div>
            `;
        }
    } else {
        titleEl.textContent = `Upload Rejected: Set ${setLetter} Exceeds Duplicate Limit`;
        subtitleEl.textContent = `Maximum of 10 recycled questions allowed from past sessions.`;
        alertBox.className = 'alert-box alert-danger';
        summaryEl.innerHTML = `
            Your uploaded question paper was rejected. 
            <strong>${recycledCount} questions</strong> are recycled from past sessions (policy limit: ≤ 10), 
            <strong>${internalCount} questions</strong> are repeated inside the same paper, and 
            <strong>${crossSetCount} questions</strong> repeat across Set A and Set B.
        `;
    }

    renderAuditTable();
    modal.style.display = 'flex';
}

function setAuditViewFilter(mode) {
    state.auditViewFilter = mode;
    const btnFlagged = document.getElementById('btn-filter-flagged');
    const btnAll = document.getElementById('btn-filter-all');

    if (btnFlagged && btnAll) {
        if (mode === 'flagged') {
            btnFlagged.className = 'btn btn-sm btn-primary active';
            btnAll.className = 'btn btn-sm btn-secondary';
        } else {
            btnFlagged.className = 'btn btn-sm btn-secondary';
            btnAll.className = 'btn btn-sm btn-primary active';
        }
    }
    renderAuditTable();
}

function renderAuditTable() {
    const tbody = document.getElementById('duplicate-table-body');
    if (!tbody || !state.currentAuditData) return;

    const data = state.currentAuditData;
    const filter = state.auditViewFilter || 'flagged';
    const totalQuestions = data.totalQuestions || (data.paper ? data.paper.total_questions : 50);

    // Build the list of rows to display based on filter
    let rowsToRender = [];

    if (filter === 'flagged') {
        rowsToRender = (data.duplicates || []).map(d => ({
            isFlagged: true,
            qNo: d.uploaded_q_no,
            section: d.uploaded_section,
            qText: d.uploaded_question_text || d.question_text,
            options: d.uploaded_options,
            match: d
        }));
    } else {
        // Show all questions
        if (data.allQuestions && data.allQuestions.length > 0) {
            rowsToRender = data.allQuestions.map(q => ({
                isFlagged: q.is_flagged,
                qNo: q.q_no,
                section: q.section,
                qText: q.question_text,
                options: q.options,
                match: q.match
            }));
        } else {
            // Synthesize from duplicates
            const dupMap = new Map();
            (data.duplicates || []).forEach(d => dupMap.set(d.uploaded_q_no, d));
            rowsToRender = (data.duplicates || []).map(d => ({
                isFlagged: true,
                qNo: d.uploaded_q_no,
                section: d.uploaded_section,
                qText: d.uploaded_question_text || d.question_text,
                options: d.uploaded_options,
                match: d
            }));
        }
    }

    if (rowsToRender.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align:center; padding:3rem 1.5rem; color:#15803d; background:#f0fdf4;">
                    <i class="fa-solid fa-circle-check" style="font-size:2.5rem; margin-bottom:12px; display:block;"></i>
                    <strong style="font-size:1.1rem;">All Questions Verified Original!</strong>
                    <p style="color:#166534; font-size:0.9rem; margin-top:4px;">No duplicate or recycled questions detected from reference sessions.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rowsToRender.map(item => {
        const upOpts = item.options || {};
        const upOptsHtml = `
            <div class="options-preview-box">
                <div class="opt-row"><span class="opt-label">A</span> ${escapeHtml(upOpts.A || '—')}</div>
                <div class="opt-row"><span class="opt-label">B</span> ${escapeHtml(upOpts.B || '—')}</div>
                <div class="opt-row"><span class="opt-label">C</span> ${escapeHtml(upOpts.C || '—')}</div>
                <div class="opt-row"><span class="opt-label">D</span> ${escapeHtml(upOpts.D || '—')}</div>
            </div>
        `;

        if (!item.isFlagged || !item.match) {
            // Clean Original Question
            return `
                <tr style="background:#ffffff;">
                    <td style="vertical-align:top; padding:0.9rem 1rem; border-bottom:1px solid #e2e8f0;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                            <span class="badge-tag" style="background:#0284c7; color:#ffffff; font-weight:700; font-size:0.85rem;">Q.${item.qNo}</span>
                            <span class="badge-tag" style="background:#e0f2fe; color:#0369a1; font-size:0.75rem;">Sec ${item.section || 'A'}</span>
                        </div>
                        <div style="font-size:0.9rem; color:#1e293b; font-weight:600; line-height:1.45; margin-bottom:6px;">
                            ${escapeHtml(item.qText)}
                        </div>
                        ${upOptsHtml}
                    </td>
                    <td style="text-align:center; vertical-align:middle; padding:0.9rem 0.5rem; border-bottom:1px solid #e2e8f0; background:#f8fafc;">
                        <span class="badge-tag" style="background:#dcfce7; color:#15803d; font-weight:600; padding:4px 8px; font-size:0.78rem;">
                            <i class="fa-solid fa-check"></i> Original (0%)
                        </span>
                    </td>
                    <td style="vertical-align:middle; text-align:center; padding:0.9rem 1rem; border-bottom:1px solid #e2e8f0; color:#94a3b8; font-style:italic; font-size:0.85rem; background:#f8fafc;">
                        <i class="fa-regular fa-circle-check" style="color:#22c55e; margin-right:4px;"></i> No duplicate found in past papers
                    </td>
                </tr>
            `;
        }

        // Flagged Duplicate Question
        const m = item.match;
        const scoreVal = m.similarity_score || 100;
        const matchTypeStr = m.match_type || '';

        let badgeBg = '#fef2f2';
        let badgeColor = '#b91c1c';
        let badgeIcon = 'fa-solid fa-triangle-exclamation';

        if (matchTypeStr.includes('Exact')) {
            badgeBg = '#fee2e2';
            badgeColor = '#991b1b';
            badgeIcon = 'fa-solid fa-clone';
        } else if (matchTypeStr.includes('Options')) {
            badgeBg = '#ffedd5';
            badgeColor = '#9a3412';
            badgeIcon = 'fa-solid fa-list-check';
        } else if (matchTypeStr.includes('Internal')) {
            badgeBg = '#f3e8ff';
            badgeColor = '#6b21a8';
            badgeIcon = 'fa-solid fa-arrows-rotate';
        } else if (matchTypeStr.includes('Cross-Set')) {
            badgeBg = '#e0e7ff';
            badgeColor = '#3730a3';
            badgeIcon = 'fa-solid fa-shuffle';
        }

        const matchOpts = m.matched_options || {};
        const matchOptsHtml = `
            <div class="options-preview-box" style="background:#fffbeb; border-color:#fde68a;">
                <div class="opt-row"><span class="opt-label" style="background:#fef3c7; color:#92400e;">A</span> ${escapeHtml(matchOpts.A || '—')}</div>
                <div class="opt-row"><span class="opt-label" style="background:#fef3c7; color:#92400e;">B</span> ${escapeHtml(matchOpts.B || '—')}</div>
                <div class="opt-row"><span class="opt-label" style="background:#fef3c7; color:#92400e;">C</span> ${escapeHtml(matchOpts.C || '—')}</div>
                <div class="opt-row"><span class="opt-label" style="background:#fef3c7; color:#92400e;">D</span> ${escapeHtml(matchOpts.D || '—')}</div>
            </div>
        `;

        return `
            <tr style="background:#fff7ed;">
                <td style="vertical-align:top; padding:0.9rem 1rem; border-bottom:1px solid #fed7aa;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                        <span class="badge-tag" style="background:#ea580c; color:#ffffff; font-weight:700; font-size:0.85rem;">Q.${item.qNo}</span>
                        <span class="badge-tag" style="background:#ffedd5; color:#9a3412; font-size:0.75rem;">Sec ${item.section || 'A'}</span>
                    </div>
                    <div style="font-size:0.9rem; color:#1e293b; font-weight:600; line-height:1.45; margin-bottom:6px;">
                        ${escapeHtml(item.qText)}
                    </div>
                    ${upOptsHtml}
                </td>
                <td style="text-align:center; vertical-align:middle; padding:0.9rem 0.5rem; border-bottom:1px solid #fed7aa; background:#fffbeb;">
                    <div style="margin-bottom:6px;">
                        <span class="badge-tag" style="background:${badgeBg}; color:${badgeColor}; font-weight:700; padding:5px 9px; font-size:0.8rem; display:inline-block;">
                            <i class="${badgeIcon}"></i> ${escapeHtml(matchTypeStr)}
                        </span>
                    </div>
                    <div style="font-size:0.75rem; color:#b45309; font-weight:600;">
                        ${scoreVal}% Match
                    </div>
                    <div style="font-size:0.72rem; color:#64748b; margin-top:6px;">
                        <i class="fa-solid fa-arrow-right"></i>
                    </div>
                </td>
                <td style="vertical-align:top; padding:0.9rem 1rem; border-bottom:1px solid #fed7aa; background:#fefce8;">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="badge-tag" style="background:#ca8a04; color:#ffffff; font-weight:700; font-size:0.85rem;">Q.${m.matched_q_no}</span>
                            <span class="badge-tag" style="background:#fef08a; color:#854d0e; font-size:0.75rem; font-weight:600;">${escapeHtml(m.matched_session)} &bull; ${escapeHtml(m.matched_set)}</span>
                        </div>
                    </div>
                    <div style="font-size:0.9rem; color:#1e293b; font-weight:600; line-height:1.45; margin-bottom:6px;">
                        ${escapeHtml(m.matched_question_text || '—')}
                    </div>
                    ${matchOptsHtml}
                    ${m.reason ? `<div style="font-size:0.75rem; color:#dc2626; margin-top:6px; font-weight:500;"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(m.reason)}</div>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

function closeDuplicateModal() {
    const modal = document.getElementById('duplicate-modal');
    if (modal) modal.style.display = 'none';
}

function exportDuplicatesCSV() {
    if (!state.currentDuplicates || state.currentDuplicates.length === 0) {
        showToast('No duplicate data to export', 'error');
        return;
    }

    const headers = ['Uploaded_Set', 'Uploaded_Q_No', 'Section', 'Uploaded_Question_Text', 'Uploaded_Options', 'Matched_Session', 'Matched_Set', 'Matched_Q_No', 'Matched_Question_Text', 'Matched_Options', 'Similarity_Score', 'Match_Type', 'Reason'];
    const rows = state.currentDuplicates.map(d => {
        const upOptsStr = d.uploaded_options ? `A: ${d.uploaded_options.A} | B: ${d.uploaded_options.B} | C: ${d.uploaded_options.C} | D: ${d.uploaded_options.D}` : '';
        const matchOptsStr = d.matched_options ? `A: ${d.matched_options.A} | B: ${d.matched_options.B} | C: ${d.matched_options.C} | D: ${d.matched_options.D}` : '';
        return [
            `"Set ${d.uploaded_set}"`,
            d.uploaded_q_no,
            `"Section ${d.uploaded_section}"`,
            `"${(d.uploaded_question_text || d.question_text || '').replace(/"/g, '""')}"`,
            `"${upOptsStr.replace(/"/g, '""')}"`,
            `"${d.matched_session}"`,
            `"${d.matched_set}"`,
            d.matched_q_no,
            `"${(d.matched_question_text || '').replace(/"/g, '""')}"`,
            `"${matchOptsStr.replace(/"/g, '""')}"`,
            `"${d.similarity_score || 100}%"`,
            `"${d.match_type || 'Match'}"`,
            `"${(d.reason || '').replace(/"/g, '""')}"`
        ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Question_Paper_Integrity_Report_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Integrity Report exported as CSV', 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN VIEW & MATRIX
// ─────────────────────────────────────────────────────────────────────────────

async function renderAdminView() {
    switchView('view-admin');
    await loadAdminMatrix();
}

async function loadAdminMatrix() {
    try {
        const res = await api('/api/admin/question-papers');
        state.adminDepts = res.departments || [];
        updateAdminStats();
        renderAdminMatrixTable();
    } catch (e) {
        showToast(`Failed to load admin matrix: ${e.message}`, 'error');
    }
}

function updateAdminStats() {
    const total = state.adminDepts.length;
    let setA = 0;
    let setB = 0;
    let full = 0;

    state.adminDepts.forEach(d => {
        if (d.setA) setA++;
        if (d.setB) setB++;
        if (d.setA && d.setB) full++;
    });

    document.getElementById('stat-total-depts').textContent = total;
    document.getElementById('stat-set-a-done').textContent = setA;
    document.getElementById('stat-set-b-done').textContent = setB;
    document.getElementById('stat-fully-complete').textContent = full;
}

function filterAdminMatrix(campus, btn) {
    state.currentFilterCampus = campus;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderAdminMatrixTable();
}

function searchAdminMatrix(query) {
    state.searchQuery = (query || '').toLowerCase().trim();
    renderAdminMatrixTable();
}

function renderAdminMatrixTable() {
    const tbody = document.getElementById('admin-matrix-tbody');
    if (!tbody) return;

    let filtered = state.adminDepts;
    if (state.currentFilterCampus !== 'all') {
        filtered = filtered.filter(d => d.campus_name.toLowerCase().includes(state.currentFilterCampus.toLowerCase()));
    }
    if (state.searchQuery) {
        filtered = filtered.filter(d => d.dept_name.toLowerCase().includes(state.searchQuery));
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 2rem; color: var(--text-muted);">No departments match the criteria.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(d => {
        const setAHtml = d.setA ? `
            <span class="badge-tag" style="background:#dcfce7; color:#15803d; margin-bottom:4px;">
                <i class="fa-solid fa-check"></i> Uploaded
            </span><br>
            <a href="javascript:void(0)" onclick="downloadFileWithAuth('/api/question-papers/download/${d.setA.id}', '${escapeHtml(d.setA.file_name)}')" style="font-size: 0.75rem; color: var(--primary); text-decoration: underline;">
                ${escapeHtml(d.setA.file_name)}
            </a>
        ` : `<span class="badge-tag" style="background:#fee2e2; color:#b91c1c;"><i class="fa-solid fa-xmark"></i> Pending</span>`;

        const setBHtml = d.setB ? `
            <span class="badge-tag" style="background:#dcfce7; color:#15803d; margin-bottom:4px;">
                <i class="fa-solid fa-check"></i> Uploaded
            </span><br>
            <a href="javascript:void(0)" onclick="downloadFileWithAuth('/api/question-papers/download/${d.setB.id}', '${escapeHtml(d.setB.file_name)}')" style="font-size: 0.75rem; color: var(--primary); text-decoration: underline;">
                ${escapeHtml(d.setB.file_name)}
            </a>
        ` : `<span class="badge-tag" style="background:#fee2e2; color:#b91c1c;"><i class="fa-solid fa-xmark"></i> Pending</span>`;

        let statusBadge = '';
        if (d.setA && d.setB) {
            statusBadge = `<span class="badge-tag" style="background:#dcfce7; color:#15803d; font-size:0.8rem; padding: 4px 10px;"><i class="fa-solid fa-circle-check"></i> Complete</span>`;
        } else if (d.setA || d.setB) {
            statusBadge = `<span class="badge-tag" style="background:#fef3c7; color:#b45309; font-size:0.8rem; padding: 4px 10px;"><i class="fa-solid fa-clock"></i> Partially Submitted</span>`;
        } else {
            statusBadge = `<span class="badge-tag" style="background:#f1f5f9; color:#64748b; font-size:0.8rem; padding: 4px 10px;"><i class="fa-solid fa-circle-minus"></i> Not Started</span>`;
        }

        return `
            <tr>
                <td><strong>${escapeHtml(d.dept_name)}</strong></td>
                <td><span class="campus-badge" style="background:#e2e8f0; color:#334155;">${escapeHtml(d.campus_name)}</span></td>
                <td>${setAHtml}</td>
                <td>${setBHtml}</td>
                <td>${statusBadge}</td>
                <td style="text-align: center;">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="openPastPapersModal(${d.dept_id}, ${d.campus_id})" style="background: #f8fafc; color: #1e293b; border: 1px solid #cbd5e1; font-weight: 500; font-size: 0.78rem;" title="Inspect, replace, or delete the 4 baseline question papers for this department">
                        <i class="fa-solid fa-clock-rotate-left" style="color: #3b82f6;"></i> Past Papers
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Security Helper
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAST REFERENCE QUESTION PAPERS MANAGER (MODAL & CRUD)
// ─────────────────────────────────────────────────────────────────────────────

state.pastManagerDepts = [];
state.currentPastDeptId = null;
state.currentPastCampusId = null;

async function openPastPapersModal(deptId = null, campusId = null) {
    const modal = document.getElementById('past-papers-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    const statusMsg = document.getElementById('past-modal-status-msg');
    if (statusMsg) statusMsg.textContent = '';

    try {
        if (state.user && state.user.role === 'hod') {
            // HOD can only manage their own department
            deptId = state.user.department_id;
            campusId = state.user.campus_id;
            const selectEl = document.getElementById('past-dept-select');
            selectEl.innerHTML = `<option value="${deptId}_${campusId}">${escapeHtml(state.user.department_name || 'My Department')} (${escapeHtml(state.user.campus_name || 'Campus')})</option>`;
            selectEl.disabled = true;
            await loadDepartmentPastPapers(deptId, campusId);
        } else {
            // Admin: load all departments for dropdown
            const res = await api('/api/admin/departments/list-detailed');
            state.pastManagerDepts = res.departments || [];

            const selectEl = document.getElementById('past-dept-select');
            selectEl.disabled = false;

            // Group by campus
            const rmpDepts = state.pastManagerDepts.filter(d => d.campus_id === 1);
            const tryDepts = state.pastManagerDepts.filter(d => d.campus_id === 2);

            let optionsHtml = '';
            if (rmpDepts.length > 0) {
                optionsHtml += `<optgroup label="Ramapuram Campus">`;
                rmpDepts.forEach(d => {
                    optionsHtml += `<option value="${d.dept_id}_${d.campus_id}">[RMP] ${escapeHtml(d.dept_name)} — ${escapeHtml(d.inst_name)} (${d.past_papers_count}/4 papers)</option>`;
                });
                optionsHtml += `</optgroup>`;
            }
            if (tryDepts.length > 0) {
                optionsHtml += `<optgroup label="Trichy Campus">`;
                tryDepts.forEach(d => {
                    optionsHtml += `<option value="${d.dept_id}_${d.campus_id}">[TRY] ${escapeHtml(d.dept_name)} — ${escapeHtml(d.inst_name)} (${d.past_papers_count}/4 papers)</option>`;
                });
                optionsHtml += `</optgroup>`;
            }

            selectEl.innerHTML = optionsHtml;

            // If a specific dept was selected, select it; else pick first
            if (deptId && campusId) {
                selectEl.value = `${deptId}_${campusId}`;
            } else if (state.pastManagerDepts.length > 0) {
                const first = state.pastManagerDepts[0];
                deptId = first.dept_id;
                campusId = first.campus_id;
                selectEl.value = `${deptId}_${campusId}`;
            }

            if (deptId && campusId) {
                await loadDepartmentPastPapers(deptId, campusId);
            }
        }
    } catch (e) {
        showToast('Failed to initialize past papers manager: ' + e.message, 'error');
    }
}

function closePastPapersModal() {
    const modal = document.getElementById('past-papers-modal');
    if (modal) modal.style.display = 'none';
}

async function onPastDeptSelectChange(val) {
    if (!val) return;
    const parts = val.split('_').map(Number);
    const deptId = parts[0];
    const campusId = parts[1];
    await loadDepartmentPastPapers(deptId, campusId);
}

async function loadDepartmentPastPapers(deptId, campusId) {
    state.currentPastDeptId = deptId;
    state.currentPastCampusId = campusId;

    const container = document.getElementById('past-papers-cards-container');
    container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: #64748b;">
            <i class="fa-solid fa-spinner fa-spin"></i> Loading reference papers...
        </div>
    `;

    try {
        const res = await api(`/api/admin/departments/${deptId}/past-papers?campusId=${campusId}`);
        const dept = res.department;
        const pastPapers = res.pastPapers || [];

        // Update Header Meta
        const campusBadge = document.getElementById('past-dept-campus-badge');
        if (campusBadge) campusBadge.textContent = dept.campus_name;

        const activeCount = pastPapers.filter(p => p.is_uploaded).length;
        const totalQuestions = pastPapers.reduce((sum, p) => sum + (p.question_count || 0), 0);
        const summaryText = document.getElementById('past-dept-summary-text');
        if (summaryText) {
            summaryText.innerHTML = `<strong>${activeCount} of 4</strong> baseline papers active &bull; <strong>${totalQuestions}</strong> MCQs indexed in DB`;
        }

        renderPastPapersGrid(pastPapers);
    } catch (e) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: #ef4444;">
                <i class="fa-solid fa-triangle-exclamation"></i> Error loading past papers: ${escapeHtml(e.message)}
            </div>
        `;
    }
}

function renderPastPapersGrid(pastPapers) {
    const container = document.getElementById('past-papers-cards-container');
    if (!container) return;

    container.innerHTML = pastPapers.map(slot => {
        const uploadDate = slot.created_at ? new Date(slot.created_at).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric'
        }) : '';

        const statusBadge = slot.is_uploaded
            ? `<span class="badge-tag" style="background:#dcfce7; color:#15803d; font-size:0.75rem;"><i class="fa-solid fa-circle-check"></i> Indexed (${slot.question_count} MCQs)</span>`
            : `<span class="badge-tag" style="background:#fee2e2; color:#b91c1c; font-size:0.75rem;"><i class="fa-solid fa-circle-xmark"></i> Not Uploaded / Missing</span>`;

        const detailsHtml = slot.is_uploaded ? `
            <div style="margin-top: 0.75rem; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem;">
                <div style="display: flex; align-items: flex-start; gap: 8px;">
                    <i class="fa-solid fa-file-word" style="color: #2563eb; font-size: 1.4rem; margin-top: 2px;"></i>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 600; font-size: 0.85rem; color: #0f172a; word-break: break-word;">
                            ${escapeHtml(slot.file_name)}
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">
                            <i class="fa-regular fa-clock"></i> Uploaded: ${uploadDate}
                        </div>
                    </div>
                </div>
            </div>
        ` : `
            <div style="margin-top: 0.75rem; background: #fffbeb; border: 1px dashed #fde68a; border-radius: 6px; padding: 0.75rem; text-align: center;">
                <span style="font-size: 0.8rem; color: #b45309;">
                    <i class="fa-solid fa-triangle-exclamation"></i> No reference file uploaded. Duplicate check has no baseline for this set.
                </span>
            </div>
        `;

        const actionsHtml = slot.is_uploaded ? `
            <div style="display: flex; gap: 6px; margin-top: 1rem; flex-wrap: wrap;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="downloadFileWithAuth('/api/hod/past-question-papers/download?id=${slot.id}', '${escapeHtml(slot.file_name)}')" style="flex: 1; min-width: 90px;">
                    <i class="fa-solid fa-download"></i> Download
                </button>
                <button type="button" class="btn btn-danger btn-sm" onclick="deletePastPaperAction(${slot.id}, '${slot.set_name}', '${escapeHtml(slot.title)}')" style="flex: 1; min-width: 80px;">
                    <i class="fa-solid fa-trash-can"></i> Delete
                </button>
                <button type="button" class="btn btn-primary btn-sm" onclick="triggerPastPaperFileInput('${slot.set_name}')" style="flex: 1; min-width: 110px;">
                    <i class="fa-solid fa-arrows-rotate"></i> Replace DOCX
                </button>
            </div>
        ` : `
            <div style="margin-top: 1rem;">
                <button type="button" class="btn btn-primary btn-sm" onclick="triggerPastPaperFileInput('${slot.set_name}')" style="width: 100%;">
                    <i class="fa-solid fa-cloud-arrow-up"></i> Upload DOCX Paper
                </button>
            </div>
        `;

        return `
            <div class="past-paper-card" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 4px;">
                        <div style="font-weight: 700; font-size: 0.95rem; color: #1e293b;">
                            <i class="fa-regular fa-calendar-check" style="color: #3b82f6;"></i> ${escapeHtml(slot.title)}
                        </div>
                        ${statusBadge}
                    </div>
                    ${detailsHtml}
                </div>
                ${actionsHtml}
                <input type="file" id="past-input-${slot.set_name}" accept=".docx" style="display: none;" onchange="handlePastFileInputSelected(event, '${slot.set_name}')">
            </div>
        `;
    }).join('');
}

function triggerPastPaperFileInput(setName) {
    const input = document.getElementById(`past-input-${setName}`);
    if (input) {
        input.value = '';
        input.click();
    }
}

function handlePastFileInputSelected(e, setName) {
    if (e.target.files && e.target.files[0]) {
        uploadPastPaperFile(setName, e.target.files[0]);
    }
}

async function uploadPastPaperFile(setName, file) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
        showToast('Please upload a valid Microsoft Word document (.docx).', 'error');
        return;
    }

    if (!state.currentPastDeptId) {
        showToast('No department selected.', 'error');
        return;
    }

    const deptId = state.currentPastDeptId;
    const campusId = state.currentPastCampusId;

    const formData = new FormData();
    formData.append('set_name', setName);
    formData.append('file', file);

    const statusMsg = document.getElementById('past-modal-status-msg');
    if (statusMsg) statusMsg.textContent = `Uploading and parsing MCQs for ${setName}...`;
    showToast(`Parsing and indexing ${setName} DOCX...`, 'info');

    try {
        const res = await api(`/api/admin/departments/${deptId}/past-paper/upload`, 'POST', formData, true);
        showToast(res.message || `Uploaded ${setName} successfully!`, 'success');
        if (statusMsg) statusMsg.textContent = `✓ Saved: ${res.fileName} (${res.questionCount} MCQs indexed)`;

        // Reload modal cards
        await loadDepartmentPastPapers(deptId, campusId);

        // Also refresh Admin Matrix if in Admin view
        if (state.currentView === 'view-admin') {
            await loadAdminMatrix();
        }
        // Also refresh HOD table if in HOD view
        if (state.currentView === 'view-hod') {
            await loadPastPapers();
        }
    } catch (e) {
        showToast(`Failed to upload ${setName}: ${e.message}`, 'error');
        if (statusMsg) statusMsg.textContent = `Error: ${e.message}`;
    }
}

async function deletePastPaperAction(paperId, setName, title) {
    if (!confirm(`Are you sure you want to DELETE ${title}?\n\nThis will remove the file and clean up its parsed questions from the database. The duplicate checker will no longer compare against this paper.`)) {
        return;
    }

    showToast(`Deleting ${setName}...`, 'info');
    try {
        const res = await api(`/api/admin/past-paper/${paperId}`, 'DELETE');
        showToast(res.message || `${setName} deleted successfully.`, 'success');

        const deptId = state.currentPastDeptId;
        const campusId = state.currentPastCampusId;
        await loadDepartmentPastPapers(deptId, campusId);

        if (state.currentView === 'view-admin') {
            await loadAdminMatrix();
        }
        if (state.currentView === 'view-hod') {
            await loadPastPapers();
        }
    } catch (e) {
        showToast(`Delete failed: ${e.message}`, 'error');
    }
}
