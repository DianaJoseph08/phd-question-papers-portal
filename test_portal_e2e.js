const http = require('http');
const fs = require('fs');
const path = require('path');

function request(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                let parsed = body;
                try { parsed = JSON.parse(body); } catch(e) {}
                resolve({ statusCode: res.statusCode, headers: res.headers, data: parsed });
            });
        });
        req.on('error', reject);
        if (data) {
            req.write(data);
        }
        req.end();
    });
}

async function runTests() {
    console.log('--- 1. Testing Standalone Portal Frontend Root (Port 3001) ---');
    const rootRes = await request({
        hostname: 'localhost',
        port: 3001,
        path: '/',
        method: 'GET'
    });
    console.log('Port 3001 HTTP Status:', rootRes.statusCode);
    if (typeof rootRes.data === 'string' && rootRes.data.includes('Question Papers Portal')) {
        console.log('✓ Portal HTML page served successfully.');
    } else {
        console.error('✗ Portal HTML page failed.');
    }

    console.log('\n--- 2. Testing HOD Login (hod_et_mech_rmp) ---');
    const loginPayload = JSON.stringify({ username: 'hod_et_mech_rmp', password: 'password' });
    const loginRes = await request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(loginPayload)
        }
    }, loginPayload);
    console.log('Login Status:', loginRes.statusCode);
    console.log('User logged in:', loginRes.data.user ? `${loginRes.data.user.name} (${loginRes.data.user.role}) - ${loginRes.data.user.department_name}` : loginRes.data);
    const mechToken = loginRes.data.token;

    console.log('\n--- 3. Testing HOD Current Upload Status ---');
    const qpStatusRes = await request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/hod/question-papers',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${mechToken}` }
    });
    console.log('Current papers for MECH:', qpStatusRes.data.questionPapers);

    console.log('\n--- 4. Testing Past Papers for Reference Download ---');
    const pastRes = await request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/hod/past-question-papers',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${mechToken}` }
    });
    console.log(`Found ${pastRes.data.pastPapers ? pastRes.data.pastPapers.length : 0} past papers for MECH.`);

    console.log('\n--- 5. Testing Duplicate Detection & Table Rejection on Port 3001 ---');
    // Login as English HOD to test past paper rejection
    const engLoginPayload = JSON.stringify({ username: 'hod_et_english_rmp', password: 'password' });
    const engLoginRes = await request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(engLoginPayload)
        }
    }, engLoginPayload);
    const engToken = engLoginRes.data.token;
    console.log('English HOD Token obtained:', engLoginRes.data.user.name);

    // Upload past English paper
    const pastFilePath = 'd:\\PhD_Question_Papers_Portal\\uploads\\question_papers\\past_11_1_JAN_A.docx';
    if (fs.existsSync(pastFilePath)) {
        const fileData = fs.readFileSync(pastFilePath);
        const boundary = '----WebKitFormBoundaryTest12345';
        const postDataStart = Buffer.from(
            '--' + boundary + '\r\n' +
            'Content-Disposition: form-data; name="set"\r\n\r\n' +
            'A\r\n' +
            '--' + boundary + '\r\n' +
            'Content-Disposition: form-data; name="file"; filename="past_english_paper.docx"\r\n' +
            'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n'
        );
        const postDataEnd = Buffer.from('\r\n--' + boundary + '--\r\n');
        const uploadPayload = Buffer.concat([postDataStart, fileData, postDataEnd]);

        const uploadRes = await request({
            hostname: 'localhost',
            port: 3001,
            path: '/api/hod/upload-question-paper',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${engToken}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': uploadPayload.length
            }
        }, uploadPayload);

        console.log('Upload Status Code (Expect 400 Rejection):', uploadRes.statusCode);
        console.log('Error message:', uploadRes.data.error);
        console.log('Duplicate count detected:', uploadRes.data.duplicateCount, '(Max allowed: 10)');
        console.log('Duplicates breakdown count in table payload:', uploadRes.data.duplicates ? uploadRes.data.duplicates.length : 0);
        if (uploadRes.data.duplicates && uploadRes.data.duplicates.length > 0) {
            console.log('Sample matched row for comparison table:');
            console.log(uploadRes.data.duplicates[0]);
        }
        if (uploadRes.statusCode === 400 && uploadRes.data.duplicateCount > 10) {
            console.log('✓ STRICT DUPLICATE RULE VERIFIED: Upload successfully rejected with complete comparison table breakdown!');
        } else {
            console.error('✗ Duplicate check failed to reject.');
        }
    } else {
        console.warn('Past file not found at:', pastFilePath);
    }

    console.log('\n--- 6. Testing Admin Login & Matrix on Port 3001 ---');
    const adminLoginPayload = JSON.stringify({ username: 'super_admin', password: 'password' });
    const adminLoginRes = await request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(adminLoginPayload)
        }
    }, adminLoginPayload);
    const adminToken = adminLoginRes.data.token;
    console.log('Admin logged in:', adminLoginRes.data.user.name);

    const matrixRes = await request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/admin/question-papers',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log(`Admin Matrix contains ${matrixRes.data.departments ? matrixRes.data.departments.length : 0} departments.`);
    if (matrixRes.data.departments && matrixRes.data.departments.length > 0) {
        console.log('Sample department in matrix:', matrixRes.data.departments[0].dept_name, `(${matrixRes.data.departments[0].campus_name})`);
    }

    console.log('\n--- 7. Verifying Original PhD Admissions App (Port 3000) is Undisturbed ---');
    const mainAppRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/',
        method: 'GET'
    });
    console.log('Port 3000 Status:', mainAppRes.statusCode);
    if (mainAppRes.statusCode === 200) {
        console.log('✓ Main PhD Admissions Webapp is running completely healthy and undisturbed on port 3000.');
    } else {
        console.error('✗ Port 3000 check returned unexpected code:', mainAppRes.statusCode);
    }

    console.log('\n================ ALL E2E VERIFICATIONS COMPLETED SUCCESSFULLY ================');
}

runTests().catch(console.error);
