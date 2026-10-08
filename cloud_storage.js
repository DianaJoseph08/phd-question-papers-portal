const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

const isGCP = Boolean(process.env.K_SERVICE || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCS_BUCKET_NAME || process.env.GAE_ENV);
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'pragmatic-app-505807-g5-phd-portal-docs';
let storage = null;
let bucket = null;
let gcsAvailable = false;

function initStorage() {
    if (storage) return;
    if (!isGCP) return;
    try {
        storage = new Storage();
        bucket = storage.bucket(BUCKET_NAME);
        gcsAvailable = true;
    } catch (e) {
        console.warn(`[Storage] Cloud Storage init notice: ${e.message}`);
    }
}

async function getBucket() {
    initStorage();
    if (!gcsAvailable || !bucket) return null;
    return bucket;
}

async function ensureBucketExists() {
    const b = await getBucket();
    if (!b) return false;
    try {
        const [exists] = await b.exists();
        if (!exists) {
            console.log(`[Storage] Creating permanent bucket ${BUCKET_NAME} in asia-south1...`);
            await storage.createBucket(BUCKET_NAME, {
                location: 'asia-south1',
                storageClass: 'STANDARD'
            });
            console.log(`[Storage] Permanent bucket ${BUCKET_NAME} created successfully.`);
        } else {
            console.log(`[Storage] Connected to permanent Cloud Storage bucket: ${BUCKET_NAME}`);
        }
        return true;
    } catch (err) {
        console.warn(`[Storage] Bucket access check notice: ${err.message}. Local disk storage active.`);
        return false;
    }
}

// Upload file to GCS
async function saveToCloudStorage(localFilePath, gcsDestinationPath) {
    const b = await getBucket();
    if (!b || !fs.existsSync(localFilePath)) return false;
    try {
        await b.upload(localFilePath, {
            destination: gcsDestinationPath,
            resumable: false,
            metadata: {
                cacheControl: 'no-cache'
            }
        });
        console.log(`[Storage] Uploaded to permanent bucket: ${gcsDestinationPath}`);
        return true;
    } catch (err) {
        console.warn(`[Storage] Failed to upload to permanent bucket (${gcsDestinationPath}):`, err.message);
        return false;
    }
}

// Delete file from GCS
async function deleteFromCloudStorage(gcsDestinationPath) {
    const b = await getBucket();
    if (!b) return false;
    try {
        const file = b.file(gcsDestinationPath);
        const [exists] = await file.exists();
        if (exists) {
            await file.delete();
            console.log(`[Storage] Deleted from permanent bucket: ${gcsDestinationPath}`);
        }
        return true;
    } catch (err) {
        console.warn(`[Storage] Failed to delete from permanent bucket (${gcsDestinationPath}):`, err.message);
        return false;
    }
}

// Download file buffer from GCS
async function getBufferFromCloudStorage(gcsDestinationPath) {
    const b = await getBucket();
    if (!b) return null;
    try {
        const file = b.file(gcsDestinationPath);
        const [exists] = await file.exists();
        if (!exists) return null;
        const [buf] = await file.download();
        return buf;
    } catch (err) {
        console.warn(`[Storage] Error downloading from permanent bucket (${gcsDestinationPath}):`, err.message);
        return null;
    }
}

// Backup SQLite papers.db to permanent bucket
async function backupDatabaseToGCS(dbPath) {
    if (!fs.existsSync(dbPath)) return false;
    return saveToCloudStorage(dbPath, 'database/papers.db');
}

// Restore SQLite papers.db from permanent bucket on startup
async function restoreDatabaseFromGCS(targetDbPath) {
    try {
        const remoteBuf = await getBufferFromCloudStorage('database/papers.db');
        if (remoteBuf && remoteBuf.length > 0) {
            fs.writeFileSync(targetDbPath, remoteBuf);
            console.log(`[Storage] Successfully restored latest papers.db (${remoteBuf.length} bytes) from permanent bucket.`);
            return true;
        }
    } catch (e) {
        console.warn('[Storage] Remote database restore notice:', e.message);
    }
    return false;
}

// Background sync of existing local files to permanent bucket
async function syncInitialFilesToGCS(filesDir) {
    const b = await getBucket();
    if (!b || !fs.existsSync(filesDir)) return;
    try {
        const files = fs.readdirSync(filesDir).filter(f => f.toLowerCase().endsWith('.docx'));
        for (const file of files) {
            const localPath = path.join(filesDir, file);
            const gcsPath = `files/${file}`;
            const gcsFile = b.file(gcsPath);
            const [exists] = await gcsFile.exists().catch(() => [false]);
            if (!exists) {
                await saveToCloudStorage(localPath, gcsPath);
            }
        }
    } catch (e) {
        console.warn('[Storage] Initial files sync notice:', e.message);
    }
}

module.exports = {
    get BUCKET_NAME() { return BUCKET_NAME; },
    ensureBucketExists,
    saveToCloudStorage,
    deleteFromCloudStorage,
    getBufferFromCloudStorage,
    backupDatabaseToGCS,
    restoreDatabaseFromGCS,
    syncInitialFilesToGCS
};
