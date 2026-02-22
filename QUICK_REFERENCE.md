# 🚀 Quick Reference - Security & Git

## Before Every Commit

```bash
# Windows
check-secrets.bat

# Linux/Mac
bash check-secrets.sh
```

---

## Files That Stay Local (Never Committed)

❌ **backend/.env** - Your SMTP password  
❌ **backend/firebase-admin-sdk.json** - Your Firebase private key  
❌ **frontend/.env** - Your Firebase config  
❌ **test-password-reset.html** - Has your credentials  
❌ **test-password-reset-debug.html** - Has your credentials

✅ These are **git-ignored** automatically

---

## Safe to Commit

✅ All `.jsx` and `.py` source files  
✅ `.env.example` files (placeholders only)  
✅ Documentation (.md files)  
✅ Configuration templates  
✅ `package.json` and `requirements.txt`

---

## Quick Commands

```bash
# See what will be committed
git status

# Check ignored files
git status --ignored

# Stage all (sensitive files auto-excluded)
git add .

# Run security check
check-secrets.bat

# Commit safely
git commit -m "Your message"

# Push to GitHub
git push origin main
```

---

## Emergency: If Secrets Were Committed

1. **Immediately rotate ALL credentials:**
   - Firebase: New service account key
   - Gmail: New app password

2. **Remove from git:**

   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch PATH/TO/FILE" \
     --prune-empty --tag-name-filter cat -- --all

   git push origin --force --all
   ```

3. **Or use BFG Repo-Cleaner** (easier)

---

## Verify Repository is Safe

On GitHub:

1. Go to your repository
2. Navigate to `backend/` folder
3. Should **NOT** see:
   - `.env`
   - `firebase-admin-sdk.json`
   - Any `.json` files

✅ If you don't see them → **Secure!**

---

## For New Team Members

```bash
# Clone repo
git clone <your-repo-url>

# Setup backend
cd backend
cp .env.example .env
# Edit with their own credentials

# Setup frontend
cd ../frontend
cp .env.example .env
# Edit with Firebase config

# Get Firebase key from Firebase Console
# (They need their own)
```

---

## Documentation

- 📘 **SECURITY.md** - Full security guide
- 📗 **SETUP.md** - Setup instructions
- 📙 **GITHUB_SECURITY.md** - Detailed checklist
- 📕 **EMAIL_SETUP.md** - Email configuration

---

## Security Check Status

Run `check-secrets.bat` to see:

- ✅ Git-ignored files configured
- ✅ No secrets in staged changes
- ✅ Safe to commit

---

**Keep this file handy for quick reference! 📌**
