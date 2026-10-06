#!/usr/bin/env bash
set -e

echo "========================================================================"
echo " SRMIST PhD Question Papers Portal - Production Setup on Google Cloud VM"
echo "========================================================================"

# Ensure script is run as root / sudo
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Please run as root: sudo bash deploy/setup.sh"
    exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
echo "[1/7] Working directory: $APP_DIR"

# 1. Update APT Packages
echo "[2/7] Updating system packages..."
apt-get update -y
apt-get install -y curl build-essential python3 git nginx certbot python3-certbot-nginx

# 2. Install Node.js 20 LTS if not present
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 18 ]; then
    echo "[3/7] Installing Node.js 20 LTS from NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "[3/7] Node.js is already installed: $(node -v)"
fi

# 3. Install PM2 process manager
echo "[4/7] Ensuring PM2 is installed globally..."
npm install -g pm2

# 4. Install Application Dependencies (Compiles native sqlite3 for Linux)
echo "[5/7] Installing project dependencies with npm..."
npm install

# Ensure upload directories exist
mkdir -p uploads/temp uploads/question_papers uploads/Jan27
chmod -R 775 uploads

# 5. Configure Nginx Reverse Proxy
echo "[6/7] Configuring Nginx reverse proxy (Port 80 -> Port 3001)..."
cp deploy/nginx.conf /etc/nginx/sites-available/default
nginx -t
systemctl restart nginx
systemctl enable nginx

# 6. Configure & Start Application with PM2
echo "[7/7] Starting application with PM2..."
pm2 stop srmist-phd-portal 2>/dev/null || true
pm2 delete srmist-phd-portal 2>/dev/null || true
pm2 start deploy/ecosystem.config.js
pm2 save

# Setup PM2 startup hook on boot
SUDO_USER_NAME="${SUDO_USER:-root}"
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$SUDO_USER_NAME" --hp "/home/$SUDO_USER_NAME" || pm2 startup systemd -u root --hp /root || true
pm2 save

# Configure firewall rules if ufw is active
if ufw status | grep -q "Status: active"; then
    echo "Opening firewall ports for HTTP, HTTPS, and SSH..."
    ufw allow 22/tcp
    ufw allow 'Nginx Full'
fi

PUBLIC_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "YOUR_VM_EXTERNAL_IP")

echo ""
echo "========================================================================"
echo " SUCCESS! SRMIST PhD Question Papers Portal is Live on Google Cloud!"
echo "========================================================================"
echo " - Web Access URL:       http://${PUBLIC_IP}"
echo " - Process Status:       pm2 status"
echo " - Application Logs:     pm2 logs srmist-phd-portal"
echo " - Nginx Access/Errors:  /var/log/nginx/"
echo ""
echo " To enable free HTTPS with SSL (if you have a domain like phdqp.srmist.edu.in):"
echo "   sudo certbot --nginx -d your-domain.com"
echo "========================================================================"
