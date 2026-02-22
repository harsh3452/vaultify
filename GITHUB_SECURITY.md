# Vaultify - Security Configuration Guide

## 🔐 Before Committing to GitHub

Your repository is now configured to be **GitHub-safe** with proper security practices.

### ✅ What's Protected

The following files are **git-ignored** and will **never be committed**:

**Backend:**

- `backend/.env` - SMTP credentials, API keys
- `backend/firebase-admin-sdk.json` - Firebase private key (contains YOUR service account credentials)
- `backend/*.json` - All JSON files in backend

**Frontend:**

- `frontend/.env` - Firebase client configuration
- `frontend/.env.local` - Local environment overrides

**Test Files:**

- `test-password-reset.html` - Has your Firebase config
- `test-password-reset-debug.html` - Has your Firebase config
- `update-firebase-config.bat` - Helper script

### 📝 What's Safe to Commit

These files use **placeholders only**:

- ✅ `backend/.env.example`
- ✅ `frontend/.env.example`
- ✅ `test-password-reset.template.html`
- ✅ All source code files
- ✅ Documentation files

---

## 🚀 Quick Start (Safe)

### 1️⃣ Verify Git Configuration

Run the security check:

```bash
# Windows
check-secrets.bat

# Linux/Mac
bash check-secrets.sh
```

This will verify:

- ✅ No sensitive files are being tracked
- ✅ .gitignore is properly configured
- ✅ No secrets in staged changes

### 2️⃣ Check What Will Be Committed

```bash
# See what files are tracked
git status

# See what will be committed
git diff --cached --name-only

# Verify sensitive files are ignored
git status --ignored | grep -E "\.env|\.json|test-password"
```

### 3️⃣ Safe First Commit

```bash
# Stage files (sensitive ones will be ignored automatically)
git add .

# Run security check
check-secrets.bat    # or check-secrets.sh

# If check passes, commit
git commit -m "Initial commit - secure configuration"

# Push to GitHub
git push origin main
```

---

## 🔍 Verify Repository is Secure

After pushing to GitHub:

### Check 1: Browse GitHub Repository

1. Go to your GitHub repository
2. Navigate to `backend/` folder
3. You should **NOT** see:
   - ❌ `.env` file
   - ❌ `firebase-admin-sdk.json`
   - ❌ Any `.json` files

### Check 2: Search for Secrets

On GitHub, use the search bar:

```
password
api key
private key
firebase credentials
```

You should find **NO results** with actual credentials.

### Check 3: Clone Fresh Copy

Test in a new location:

```bash
cd /tmp
git clone https://github.com/yourusername/vaultify.git test-clone
cd test-clone

# These files should NOT exist:
ls backend/.env                    # Should not exist
ls backend/firebase-admin-sdk.json # Should not exist

# These files SHOULD exist:
ls backend/.env.example            # Should exist
ls SECURITY.md                     # Should exist
ls SETUP.md                        # Should exist
```

---

## 🛡️ Security Features Implemented

### 1. Comprehensive .gitignore

- All sensitive files excluded
- Example files explicitly allowed
- Test files with credentials ignored

### 2. Documentation

- [SECURITY.md](SECURITY.md) - Security best practices
- [SETUP.md](SETUP.md) - Safe setup guide
- [EMAIL_SETUP.md](EMAIL_SETUP.md) - Email configuration

### 3. Security Check Scripts

- `check-secrets.bat` (Windows)
- `check-secrets.sh` (Linux/Mac)

### 4. Template Files

- `.env.example` files with placeholders
- `test-password-reset.template.html` for local testing

---

## ⚠️ If You Accidentally Committed Secrets

### Immediate Actions:

1. **Rotate ALL credentials immediately:**
   - Firebase: Generate new service account key
   - SMTP: Revoke Gmail app password and create new one
   - Frontend: Can keep (no private keys) but rotate if concerned

2. **Remove from Git history:**

   ```bash
   # Remove file from entire history
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch backend/.env" \
     --prune-empty --tag-name-filter cat -- --all

   # Force push (⚠️ backup first!)
   git push origin --force --all
   ```

3. **Alternative (easier):**
   Use [BFG Repo-Cleaner](https://reps-bfg-cleaner.github.io/):

   ```bash
   bfg --delete-files firebase-admin-sdk.json
   bfg --delete-files .env
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   git push --force
   ```

4. **Verify cleanup:**
   ```bash
   git log --all --full-history -- backend/.env
   # Should show no commits
   ```

---

## 📋 Pre-Commit Checklist

Before every `git push`:

- [ ] Run `check-secrets.bat` (or `.sh`)
- [ ] Check no `.env` files are staged: `git diff --cached --name-only | grep .env`
- [ ] Check no JSON files in backend: `git diff --cached --name-only | grep backend.*json`
- [ ] Verify .gitignore is working: `git status --ignored`
- [ ] No hardcoded emails/passwords in new code
- [ ] Example files use placeholders only

---

## 🔧 How Teammates Clone Safely

When others clone your repository:

```bash
# 1. Clone repo
git clone https://github.com/yourusername/vaultify.git
cd vaultify

# 2. Setup backend
cd backend
cp .env.example .env
# Edit .env with their credentials

# 3. Setup frontend
cd ../frontend
cp .env.example .env
# Edit .env with Firebase credentials

# 4. Get Firebase Admin SDK
# Follow instructions in SETUP.md to download their own
# firebase-admin-sdk.json from Firebase Console
```

They will need:

- Their own Firebase service account key
- Their own Gmail app password
- Same Firebase project OR create their own

---

## 📊 What's in Version Control

**Included (✅):**

- Source code
- Configuration templates
- Documentation
- Dependencies list
- Git ignore rules
- Security check scripts

**Excluded (❌):**

- Environment variables (.env)
- Private keys (service accounts)
- Credentials (SMTP passwords)
- Test files with real config
- Build outputs
- Node modules

---

## 🚀 Deployment Security

For production deployments:

### Environment Variables

Set credentials via hosting platform:

- Vercel: Project Settings → Environment Variables
- Railway: Variables tab
- Heroku: Config Vars
- AWS: Systems Manager Parameter Store

### Never Do:

- ❌ Hardcode credentials in code
- ❌ Commit .env files
- ❌ Share private keys in chat/email
- ❌ Push Firebase JSON to git
- ❌ Log sensitive data

### Always Do:

- ✅ Use environment variables
- ✅ Rotate credentials regularly
- ✅ Use separate dev/prod credentials
- ✅ Enable Firebase App Check
- ✅ Monitor access logs

---

## 📞 Questions?

- **Setup Issues:** See [SETUP.md](SETUP.md)
- **Email Problems:** See [EMAIL_SETUP.md](EMAIL_SETUP.md)
- **Security Concerns:** See [SECURITY.md](SECURITY.md)
- **Report Vulnerability:** [security contact]

---

## ✅ Final Verification

Run this to confirm everything is secure:

```bash
# Windows PowerShell
Get-ChildItem -Recurse -File | Where-Object {
    $_.Name -match "\.env$" -or
    ($_.Directory.Name -eq "backend" -and $_.Extension -eq ".json")
} | ForEach-Object {
    git ls-files --error-unmatch $_.FullName 2>&1 | Out-Null
    if ($?) {
        Write-Host "❌ TRACKED: $_"
    }
}
```

If no output → ✅ **You're secure!**

---

**Your repository is now GitHub-ready with enterprise-level security! 🎉**
