# Google Cloud Deployment Guide - PhD Question Papers Portal
**Target Account**: `sureshscience@gmail.com`  
**GitHub Repository**: `https://github.com/DianaJoseph08/phd-question-papers-portal.git`  
**Application**: SRMIST PhD Entrance Examination Question Papers & Screening Portal

---

## 🚀 Fast Deployment: Google Cloud Run (Option 1)

Google Cloud Run is the recommended, serverless hosting method (just like the SIFT application). It automatically provisions a Google-managed HTTPS domain, autoscales, and requires zero virtual machine management.

### Architecture Highlights
- **Single Unified Container**: The Express.js backend serves both the portal API and the UI on standard Cloud Run port `8080`.
- **Pre-Bundled Complete State**: The container bundles:
  1. `data/papers.db` (Question papers database with all historical Set A / Set B records).
  2. `data/phd_admissions.db` (Admissions database with 66 faculty/admin accounts and 49 department mappings).
  3. `data/files/*.docx` (All 191 past reference question papers and templates).
- **Cross-Platform Path Resolver**: The runtime automatically resolves Windows disk paths (`D:\...`) to container paths, guaranteeing seamless document previews, similarity checks, and downloads on Linux.

---

### Step-by-Step Deployment Instructions

#### Step 1: Push Code to GitHub
Double-click `deploy_gcp.bat` in the project folder, or run in PowerShell:
```powershell
git add .
git commit -m "Configure PhD Question Papers Portal for Google Cloud Run"
git push -u origin main
```

#### Step 2: Open Google Cloud Console
1. Navigate to: **[https://console.cloud.google.com/](https://console.cloud.google.com/)**
2. Ensure you are signed in with **`sureshscience@gmail.com`**.
3. Select your active project (or create a new project, e.g., `srmist-phd-portal`).

#### Step 3: Open Cloud Shell & Deploy (30 Seconds)
1. In the top-right toolbar of Google Cloud Console, click the **Activate Cloud Shell** icon (`>_`).
2. In the Cloud Shell terminal that appears at the bottom, paste and run:

```bash
# 1. Clone the repository (if first time)
git clone https://github.com/DianaJoseph08/phd-question-papers-portal.git
cd phd-question-papers-portal

# (Or if already cloned previously, pull latest changes):
# cd phd-question-papers-portal && git pull origin main

# 2. Deploy directly to Cloud Run
gcloud run deploy phd-portal \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1
```

3. When prompted:
   - *Do you want to enable the Cloud Build and Artifact Registry APIs?* $\rightarrow$ Type `y` and press **Enter**.
4. Cloud Build will package the container, push the image to Google Artifact Registry, and deploy your live service.

#### Step 4: Access Your Live Application
Upon completion, Cloud Shell will display your live, secure HTTPS URL:
```text
Service [phd-portal] revision [phd-portal-00001-xxx] has been deployed and is serving 100 percent of traffic.
Service URL: https://phd-portal-xxxxxxxxx-el.a.run.app
```

Click the URL in your browser:
- You will see the **SRMIST Question Paper Office** portal.
- Sign in with any existing Admin, HoD, or research coordinator credentials from `phd_admissions.db`.
- All past session archives (January 2026, July 2026), Set A/B templates, and automated similarity checks are 100% active.

---

## 🖥️ Alternative Option: Compute Engine VM (Option 2)

If you prefer a 24/7 standalone Linux virtual machine with a dedicated persistent disk (so any new uploads stay permanently saved without container redeployment):

### 1. Create VM in Cloud Console
In Google Cloud Console $\rightarrow$ **Compute Engine** $\rightarrow$ **VM instances** $\rightarrow$ **Create Instance**:
- **Name**: `phd-portal-vm`
- **Region**: `asia-south1` (Mumbai) or `us-central1` (Iowa - Always Free)
- **Machine type**: `e2-micro` (Free tier) or `e2-small`
- **Boot disk**: Ubuntu 22.04 LTS / 24.04 LTS (20 GB)
- **Firewall**: Check **Allow HTTP traffic** and **Allow HTTPS traffic**

### 2. Connect via SSH and Run
Click the **SSH** button next to `phd-portal-vm` in the Cloud Console, and run:
```bash
sudo apt-get update && sudo apt-get install -y docker.io git
sudo systemctl enable --now docker

git clone https://github.com/DianaJoseph08/phd-question-papers-portal.git
cd phd-question-papers-portal
sudo docker build -t phd-portal .
sudo docker run -d --name phd-portal --restart unless-stopped -p 80:8080 phd-portal
```
Visit your VM's External IP (`http://<YOUR_EXTERNAL_IP>`) to access the portal.

---

## 🔍 Verification & Health Check

| Endpoint / Action | Purpose | Expected Result |
| :--- | :--- | :--- |
| `GET /healthz` | Container health probe | `{"ok":true}` (HTTP 200) |
| `GET /` | Web UI | Loads SRMIST Research Office Login page |
| `POST /api/login` | Authentication | Validates admin/HoD/coordinator accounts |
| `GET /api/state` | Portal state | Loads departments and past session papers |

---

## 🛠️ Helpful Cloud Shell Maintenance Commands

- **View Live Logs**:
  ```bash
  gcloud run services logs tail phd-portal --region asia-south1
  ```
- **Update / Redeploy after git push**:
  ```bash
  cd phd-question-papers-portal
  git pull origin main
  gcloud run deploy phd-portal --source . --region asia-south1
  ```
