# Google Cloud deployment

This app writes SQLite state and uploaded Word files. Deploy it on one Compute Engine VM with a persistent disk. Keep the admissions database and `data/` outside Git because they contain account and exam records.

## 1. Push the application code

Run these commands from the app folder after creating an empty private GitHub repository:

```powershell
git init
git branch -M main
git add Dockerfile .dockerignore deploy package.json *.js public README.md .gitignore
git commit -m "Prepare SRMIST question paper app for deployment"
git remote add origin https://github.com/ORG/REPO.git
git push -u origin main
```

`data/` and `node_modules/` are ignored. Do not force-add them.

## 2. Create the VM and persistent disk

Run in Google Cloud Shell or on a machine with the Google Cloud CLI and an authenticated account:

```bash
gcloud config set project PROJECT_ID
gcloud services enable compute.googleapis.com
gcloud compute disks create qp-data --zone=asia-south1-a --type=pd-balanced --size=20GB
gcloud compute instances create qp-app \
  --zone=asia-south1-a \
  --machine-type=e2-small \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB \
  --disk=name=qp-data,device-name=qp-data,mode=rw \
  --tags=qp-app
gcloud compute firewall-rules create qp-app-http \
  --allow=tcp:80 --target-tags=qp-app --description="SRMIST question paper app"
```

SSH to the VM, install Docker and mount the disk:

```bash
gcloud compute ssh qp-app --zone=asia-south1-a
sudo apt-get update
sudo apt-get install -y docker.io git
sudo systemctl enable --now docker
sudo mkdir -p /mnt/disks/qp-data
sudo mount -o discard,defaults /dev/disk/by-id/google-qp-data /mnt/disks/qp-data
sudo mkdir -p /mnt/disks/qp-data/data/files
sudo chown -R $USER:$USER /mnt/disks/qp-data
exit
```

## 3. Copy the private runtime data

From the local Windows machine, copy the admissions database and the app data directory to the mounted disk. These files are intentionally not in Git:

```powershell
gcloud compute scp --zone=asia-south1-a `
  "D:\Phd_Admissions_Webapp\PhD_Question_Paper_Workspace\phd_admissions.db" `
  qp-app:/tmp/phd_admissions.db
gcloud compute ssh qp-app --zone=asia-south1-a --command "sudo mv /tmp/phd_admissions.db /mnt/disks/qp-data/phd_admissions.db"
gcloud compute scp --recurse --zone=asia-south1-a `
  "D:\Phd_Admissions_Webapp\PhD_Question_Paper_Workspace\question-paper-app\data\*" `
  qp-app:/mnt/disks/qp-data/data
```

Confirm that `/mnt/disks/qp-data/data/papers.db` and `/mnt/disks/qp-data/data/files/` exist on the VM. Keep the VM at one application instance because SQLite is not a multi-writer database.

## 4. Clone and start the app

```bash
sudo mkdir -p /opt
sudo git clone https://github.com/ORG/REPO.git /opt/question-paper-app
sudo chown -R $USER:$USER /opt/question-paper-app
cd /opt/question-paper-app
sudo sh deploy/vm-run.sh
curl http://127.0.0.1/healthz
```

Open the VM external IP in a browser. For production, add a domain and HTTPS reverse proxy before sharing the URL. Back up the persistent disk and keep the VM firewall restricted if access should be internal.
