@echo off
title Push PhD Question Papers Portal to GitHub for Google Cloud
echo ==================================================================
echo   SRMIST PhD Question Papers Portal - Google Cloud Deployment
echo   Target Account: sureshscience@gmail.com
echo ==================================================================
echo.

where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Git is not found in PATH.
    pause
    exit /b
)

if not exist .git (
    echo Initializing local Git repository...
    git init
    git branch -M main
    git config user.email "candidate-assessor@srm.edu"
    git config user.name "SRM Assessment Admin"
)

git remote get-url origin >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    set /p REPO_URL="Enter your GitHub Repository URL: "
    if "%REPO_URL%"=="" (
        echo [ERROR] Repository URL cannot be empty.
        pause
        exit /b
    )
    git remote add origin %REPO_URL%
)

echo 1. Staging updated project files (Dockerfile, server, database, uploads)...
git add .

echo 2. Committing changes...
git commit -m "Update PhD Question Papers Portal for Google Cloud Run"

echo 3. Pushing to GitHub (origin main)...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ==================================================================
    echo  [SUCCESS] Code successfully pushed to GitHub!
    echo ==================================================================
    echo.
    echo Next Steps in Google Cloud (sureshscience@gmail.com):
    echo.
    echo 1. Open Google Cloud Console: https://console.cloud.google.com/
    echo 2. Click the Cloud Shell icon [>_] in the top right toolbar.
    echo 3. Run:
    echo    gcloud run deploy phd-portal --source . --region asia-south1 --allow-unauthenticated
    echo.
    echo (Note: If it is your first time in Cloud Shell, clone your repo first:)
    echo    git clone <YOUR_REPO_URL>
    echo    cd <YOUR_REPO_NAME>
    echo.
) else (
    echo.
    echo [NOTICE] Push failed or already up to date. Check message above.
)

pause
