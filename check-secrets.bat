@echo off
REM Pre-commit security check script for Windows
REM Run this before committing to ensure no secrets are exposed

echo.
echo =================================
echo   Security Pre-Commit Check
echo =================================
echo.

setlocal enabledelayedexpansion
set FOUND_ISSUES=0

echo Checking for sensitive files...
echo.

REM Check if sensitive files would be committed
set FILES=backend\.env backend\firebase-admin-sdk.json frontend\.env test-password-reset.html test-password-reset-debug.html update-firebase-config.bat

for %%f in (%FILES%) do (
    git ls-files --error-unmatch "%%f" >nul 2>&1
    if !errorlevel! equ 0 (
        echo [91mX CRITICAL:[0m %%f is tracked by git and will be committed!
        echo    Fix: git rm --cached %%f
        set FOUND_ISSUES=1
    )
)

if !FOUND_ISSUES! equ 0 (
    echo [92mOK[0m No sensitive files are being tracked
)

echo.
echo Checking .gitignore coverage...

REM Verify .gitignore includes necessary patterns
findstr /C:"backend/.env" .gitignore >nul
if errorlevel 1 (
    echo [91mX[0m .gitignore missing: backend/.env
    set FOUND_ISSUES=1
) else (
    echo [92mOK[0m backend/.env is git-ignored
)

findstr /C:"backend/*.json" .gitignore >nul
if errorlevel 1 (
    echo [91mX[0m .gitignore missing: backend/*.json
    set FOUND_ISSUES=1
) else (
    echo [92mOK[0m backend/*.json is git-ignored
)

findstr /C:"frontend/.env" .gitignore >nul
if errorlevel 1 (
    echo [91mX[0m .gitignore missing: frontend/.env
    set FOUND_ISSUES=1
) else (
    echo [92mOK[0m frontend/.env is git-ignored
)

echo.
echo Staged files that will be committed:
git diff --cached --name-only
if errorlevel 1 (
    echo    (No files staged)
)

echo.
if !FOUND_ISSUES! equ 0 (
    echo [92mSecurity check passed![0m
    echo.
    echo You can safely commit with: git commit
    exit /b 0
) else (
    echo [91mSecurity check FAILED![0m
    echo Fix the issues above before committing
    echo.
    exit /b 1
)
