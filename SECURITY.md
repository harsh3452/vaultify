# 🔐 Security Best Practices

This document outlines security best practices for the Vaultify project.

---

## 🚨 Critical: Never Commit These Files

The following files contain sensitive credentials and are git-ignored:

### Backend
- ✅ `backend/.env` - SMTP credentials, API keys
- ✅ `backend/firebase-admin-sdk.json` - Firebase private key (service account)
- ✅ `backend/*.json` - Any JSON files in backend directory

### Frontend
- ✅ `frontend/.env` - Firebase client credentials
- ✅ `frontend/.env.local` - Local environment overrides

### Test Files (with hardcoded credentials)
- ✅ `test-password-reset.html`
- ✅ `test-password-reset-debug.html`
- ✅ `update-firebase-config.bat`

---

## ✅ Files Safe to Commit

These example files use placeholders and are safe:
- ✅ `backend/.env.example`
- ✅ `frontend/.env.example`
- ✅ `test-password-reset.template.html`

---

## 🔑 Managing Sensitive Credentials

### 1. Firebase Admin SDK (Backend)

**File:** `backend/firebase-admin-sdk.json`

**How to Get:**
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project → ⚙️ Settings → Service Accounts
3. Click "Generate new private key"
4. Save as `backend/firebase-admin-sdk.json`
5. **Never commit this file!**

**Security:**
- Contains private key for Firebase Admin SDK
- Grants full access to your Firebase project
- If exposed, immediately regenerate the key

### 2. SMTP Credentials (Backend)

**File:** `backend/.env`

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-16-char-app-password  # NOT your Gmail password!
SMTP_FROM=YourApp <your-email@gmail.com>
```

**Gmail App Password Setup:**
1. Enable [2-Step Verification](https://myaccount.google.com/security)
2. Go to [App Passwords](https://myaccount.google.com/apppasswords)
3. Generate password for "Mail"
4. Use the 16-character password (no spaces)
5. **Never commit `.env` file!**

### 3. Firebase Client Config (Frontend)

**File:** `frontend/.env`

```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
# ... other config
```

**How to Get:**
1. Firebase Console → ⚙️ Settings → General
2. Scroll to "Your apps" → Web app
3. Copy the config values
4. Prefix each with `VITE_`

**Note:** These keys are public-facing but should still use `.env` for easy configuration.

---

## 🛡️ Security Checklist for Git

Before committing code, verify:

- [ ] No hardcoded passwords or API keys
- [ ] `.env` files are git-ignored
- [ ] `firebase-admin-sdk.json` is git-ignored
- [ ] Test files with credentials are git-ignored
- [ ] `.env.example` files use placeholders only
- [ ] No email addresses in test files
- [ ] No database connection strings in code

---

## 🧪 Testing Without Exposing Credentials

### Method 1: Local Test Files

Create local copies of test files:

```bash
# Copy template
cp test-password-reset.template.html test-password-reset-local.html

# Edit test-password-reset-local.html with your credentials
# This file is git-ignored (add to .gitignore if needed)
```

### Method 2: Environment Variables

For Node.js testing:
```javascript
const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    // ... load from env
};
```

### Method 3: Use Example Files

1. Copy `.env.example` → `.env`
2. Fill in real values
3. `.env` is already git-ignored

---

## 🚀 Production Security

### Firebase Security Rules

**Firestore Rules:**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Authenticated users only
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
    
    // User-specific data
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

**Storage Rules:**
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /clients/{userId}/{allPaths=**} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

### API Security

✅ **Do:**
- Use Firebase App Check in production
- Implement rate limiting
- Validate all inputs server-side
- Use HTTPS only
- Rotate credentials regularly
- Enable Firebase Security Monitoring

❌ **Don't:**
- Expose admin credentials
- Trust client-side validation
- Use weak CORS policies
- Log sensitive data
- Store passwords in plain text

---

## 🔄 If Credentials Are Exposed

If you accidentally commit sensitive data:

### 1. Rotate ALL Credentials Immediately

**Firebase:**
1. Generate new Firebase Admin SDK key
2. Delete the old key
3. Update `backend/firebase-admin-sdk.json`

**SMTP:**
1. Revoke Gmail App Password
2. Generate new App Password
3. Update `backend/.env`

### 2. Remove from Git History

```bash
# Remove file from entire git history
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch backend/.env" \
  --prune-empty --tag-name-filter cat -- --all

# Force push (⚠️ only if safe)
git push origin --force --all
```

**Alternative (easier):**
Use [BFG Repo-Cleaner](https://reps-bfg-cleaner.github.io/)

### 3. Invalidate Exposed Keys

- Firebase: Regenerate service account keys
- SMTP: Revoke app password
- API Keys: Regenerate in respective consoles

---

## 📋 Pre-Commit Checklist

Before `git push`:

```bash
# Check for exposed secrets
git diff --cached -- ':!*.example' | grep -i "password\|api.key\|secret\|private"

# Verify .gitignore is working
git status --ignored

# Check what will be committed
git diff --cached --name-only
```

---

## 🔍 Tools for Secret Scanning

- [git-secrets](https://github.com/awslabs/git-secrets) - Prevents committing secrets
- [truffleHog](https://github.com/trufflesecurity/truffleHog) - Finds secrets in git history
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning) - Automatic scanning

---

## 📞 Reporting Security Issues

If you discover a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Email: [security contact email]
3. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

---

## 📚 Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Firebase Security Rules Guide](https://firebase.google.com/docs/rules)
- [Environment Variables Best Practices](https://12factor.net/config)
- [Git Secret Management](https://git-scm.com/book/en/v2/Git-Tools-Credential-Storage)

---

**Last Updated:** February 22, 2026  
**Reviewed By:** Security Team
