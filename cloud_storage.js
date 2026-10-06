const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'pragmatic-app-505807-g5-phd-portal-docs';
let storage = null;
let bucket = null;
let gcsAvailable = false;

try {
    storage = new Storage();
    bucket = storage.bucket(BUCKET_NAME);
    // In GCP environment (Cloud Run / Cloud Shell), ADC is available automatically
    gcsAvailable = true;
    console.log(`[Storage] Configured Google Cloud Storage bucket: ${BUCKET_NAME}`);
} catch (e) {
    console.warn(`[Storage] Google Cloud Storage not initialized (offline/local fallback): ${e.message}`);
}

async function ensureBucketExists() {
    if (!gcsAvailable || !bucket) return false;
    try {
        const [exists] = await bucket.exists();
        if (!exists) {
            console.log(`[Storage] Creating bucket ${BUCKET_NAME} in asia-south1...`);
            await storage.createBucket(BUCKET_NAME, {
                location: 'asia-south1',
                storageClass: 'STANDARD'
            });
            console.log(`[Storage] Bucket ${BUCKET_NAME} created successfully.`);
        }
        return true;
    } catch (err) {
        console.warn(`[Storage] Bucket access check failed: ${err.message}. Using local disk storage fallback.`);
        return false;
    }
}

// Upload file to GCS (replaces existing file if same name)
async function saveToCloudStorage(localFilePath, gcsDestinationPath) {
    if (!gcsAvailable || !bucket) return false;
    try {
        await bucket.upload(localFilePath, {
            destination: gcsDestinationPath,
            resumable: false,
            metadata: {
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                cacheControl: 'no-cache'
            }
        });
        console.log(`[Storage] Successfully saved to GCS bucket: ${gcsDestinationPath}`);
        return true;
    } catch (err) {
        console.error(`[Storage] Failed to upload to GCS (${gcsDestinationPath}):`, err.message);
        return false;
    }
}

// Delete file from GCS
async function deleteFromCloudStorage(gcsDestinationPath) {
    if (!gcsAvailable || !bucket) return false;
    try {
        const file = bucket.file(gcsDestinationPath);
        const [exists] = await file.exists();
        if (exists) {
            await file.delete();
            console.log(`[Storage] Deleted from GCS bucket: ${gcsDestinationPath}`);
        }
        return true;
    } catch (err) {
        console.warn(`[Storage] Failed to delete from GCS (${gcsDestinationPath}):`, err.message);
        return false;
    }
}

// Download file buffer from GCS
async function getBufferFromCloudStorage(gcsDestinationPath) {
    if (!gcsAvailable || !bucket) return null;
    try {
        const file = bucket.file(gcsDestinationPath);
        const [exists] = await file.exists();
        if (!exists) return null;
        const [buf] = await file.download();
        return buf;
    } catch (err) {
        console.warn(`[Storage] Error downloading from GCS (${gcsDestinationPath}):`, err.message);
        return null;
    }
}

// Stream file to HTTP response from GCS
function streamFromCloudStorage(gcsDestinationPath, res, fileName) {
    if (!gcsAvailable || !bucket) return false;
    try {
        const file = bucket.file(gcsDestinationPath);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        const readStream = file.createReadStream();
        readStream.on('error', (err) => {
            console.error('[Storage] Stream error from GCS:', err.message);
            if (!res.headersSent) res.status(500).json({ error: 'Failed to stream file from cloud storage' });
        });
        readStream.pipe(res);
        return true;
    } catch (err) {
        return false;
    }
}

module.exports = {
    BUCKET_NAME,
    ensureBucketExists,
    saveToCloudStorage,
    deleteFromCloudStorage,
    getBufferFromCloudStorage,
    streamFromCloudStorage
};
