@echo off
title Push PhD Question Papers Portal to GitHub
echo ==================================================================
echo   SRMIST PhD Question Papers Portal - GitHub & Google Cloud Deploy
echo ==================================================================
echo.

where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Git is not installed or not in PATH.
    echo Please install Git from https://git-scm.com/
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
    echo Step 1: Create a new repository on GitHub (e.g., phd-portal)
    echo         https://github.com/new
    echo.
    set /p REPO_URL="Enter your GitHub Repository URL (e.g., https://github.com/DianaJoseph08/phd-portal.git): "
    if "%REPO_URL%"=="" (
        echo [ERROR] Repository URL cannot be empty.
        pause
        exit /b
    )
    git remote add origin %REPO_URL%
)

echo.
echo 1. Staging files (server, database, past question papers, public files)...
git add .

echo 2. Committing files...
git commit -m "Deploy PhD Question Papers Portal to Google Cloud"

echo 3. Pushing to GitHub (main)...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ==================================================================
    echo  [SUCCESS] Code successfully pushed to GitHub!
    echo ==================================================================
    echo.
    echo Next Steps in Google Cloud Shell (sureshscience@gmail.com):
    echo.
    echo 1. Open Google Cloud Console: https://console.cloud.google.com/
    echo 2. Click the Cloud Shell icon [>_] in the top-right toolbar.
    echo 3. Run the following commands:
    echo.
    echo    git clone <YOUR_GITHUB_REPO_URL>
    echo    cd <REPO_FOLDER_NAME>
    echo    gcloud run deploy phd-portal --source . --region asia-south1 --allow-unauthenticated
    echo.
    echo Cloud Run will automatically build and give you a live HTTPS URL!
    echo ==================================================================
) else (
    echo.
    echo [NOTICE] Push failed or check error above.
)

pause
