# Google Cloud Deployment Guide - PhD Question Papers Portal
**Target Account**: `sureshscience@gmail.com`  
**GitHub Repository**: `https://github.com/DianaJoseph08/phd-question-papers-portal.git`  
**Storage Architecture**: Permanent Google Cloud Storage (GCS) Bucket + Cloud Run

---

## 🪣 Permanent Bucket Persistence Architecture

Cloud Run container filesystems are temporary/ephemeral. To ensure **zero data loss** across container restarts, scale-to-zero, and revisions:

1. **Automatic Permanent Bucket Initialization**:
   - On startup, the application connects to Google Cloud Storage using Application Default Credentials (ADC).
   - Default Bucket: `${PROJECT_ID}-phd-portal-docs` (or custom name via `GCS_BUCKET_NAME`).
   - If the bucket does not exist, the app automatically creates it in `asia-south1`.
2. **Permanent Database Sync (`papers.db`)**:
   - On container boot: Checks `gs://<BUCKET>/database/papers.db`. If found, restores the latest state into the container.
   - On any upload, review, template update, or exam generation: Automatically backs up the updated SQLite database to `gs://<BUCKET>/database/papers.db`.
3. **Permanent Word Document Storage (`.docx`)**:
   - Every uploaded submission, template, and generated final exam is stored directly in `gs://<BUCKET>/files/<filename>.docx`.
   - On demand (download or preview): If a document is not present in local container cache, it is automatically fetched directly from the permanent bucket.
4. **Admissions Database (`phd_admissions.db`)**:
   - Pre-bundled with all 66 faculty accounts and 49 department mappings.

---

## 🚀 One-Click Cloud Run Deployment Instructions

### Step 1: Open Google Cloud Console
1. Navigate to: **[https://console.cloud.google.com/](https://console.cloud.google.com/)**
2. Ensure you are signed in with **`sureshscience@gmail.com`**.
3. Select your active Google Cloud project.

### Step 2: Open Cloud Shell (`>_`)
Click the **Activate Cloud Shell** icon (`>_`) in the top-right toolbar.

### Step 3: Run the Deployment Command

Paste and run the following in Cloud Shell:

```bash
# 1. Clone or pull the repository
if [ -d "phd-question-papers-portal" ]; then
  cd phd-question-papers-portal && git pull origin main
else
  git clone https://github.com/DianaJoseph08/phd-question-papers-portal.git
  cd phd-question-papers-portal
fi

# 2. Deploy directly to Cloud Run
gcloud run deploy phd-portal \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1
```

> **Note on Permissions**:
> When prompted: *Do you want to enable the Cloud Build, Artifact Registry, and Cloud Run APIs?* $\rightarrow$ Type `y` and press **Enter**.
>
> If you wish to specify an exact custom bucket name, you can pass:
> `--set-env-vars GCS_BUCKET_NAME=my-permanent-bucket-name`

---

### Step 4: Verification

Cloud Shell will output your live, secure HTTPS URL:
```text
Service [phd-portal] revision [phd-portal-00001-xxx] has been deployed and is serving 100 percent of traffic.
Service URL: https://phd-portal-xxxxxxxxx-el.a.run.app
```

### Checking Permanent Storage Sync in Live Logs:
You can verify that the permanent Cloud Storage bucket is active by viewing live logs in Cloud Shell:
```bash
gcloud run services logs tail phd-portal --region asia-south1
```
You will see:
```text
[Storage] Connected to permanent Cloud Storage bucket: <project-id>-phd-portal-docs
[Storage] Uploaded to permanent bucket: database/papers.db
```

---

## 🔒 Optional: Grant Cloud Storage Permissions (If using restricted Service Account)
If your project uses a restricted default compute service account, grant it Storage Object Admin:
```bash
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUM=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" \
  --role="roles/storage.admin"
```
