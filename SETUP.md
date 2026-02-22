# 🚀 Quick Start Guide

This guide helps you set up Vaultify safely without exposing sensitive credentials.

---

## 📋 Prerequisites

- Node.js 18+ and npm
- Python 3.9+
- Firebase account
- Gmail account (for SMTP)

---

## 🔧 Setup Instructions

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/yourusername/vaultify.git
cd vaultify
```

### 2️⃣ Backend Setup

#### Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

#### Configure Environment Variables

```bash
# Copy example file
cp .env.example .env

# Edit .env with your actual credentials
# See SECURITY.md for how to get these safely
```

**Required Environment Variables:**

```env
# Firebase Admin SDK
GOOGLE_APPLICATION_CREDENTIALS=./firebase-admin-sdk.json
FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app

# MongoDB (if used)
MONGO_URI=mongodb://localhost:27017/vaultify

# SMTP (for OTP emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-16-char-app-password
SMTP_FROM=Vaultify <your-email@gmail.com>
```

#### Get Firebase Admin SDK Key

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project → ⚙️ Settings → Service Accounts
3. Click "Generate new private key"
4. Save as `backend/firebase-admin-sdk.json`
5. **This file is git-ignored - never commit it!**

#### Get Gmail App Password

1. Enable [2-Step Verification](https://myaccount.google.com/security)
2. Go to [App Passwords](https://myaccount.google.com/apppasswords)
3. Generate password for "Mail"
4. Use the 16-character password in `SMTP_PASSWORD`

#### Run Backend

```bash
python app_secure.py
```

Backend runs on: `http://localhost:8000`

---

### 3️⃣ Frontend Setup

#### Install Dependencies

```bash
cd frontend
npm install
```

#### Configure Environment Variables

```bash
# Copy example file
cp .env.example .env

# Edit .env with your Firebase client config
```

**Required Environment Variables:**

```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
VITE_FIREBASE_MEASUREMENT_ID=your-measurement-id
```

#### Get Firebase Client Config

1. Firebase Console → ⚙️ Settings → General
2. Scroll to "Your apps" → Web app
3. If no web app exists, click "Add app" → Web
4. Copy the config values
5. Add `VITE_` prefix to each variable name

#### Run Frontend

```bash
npm run dev
```

Frontend runs on: `http://localhost:5173` (or 5174 if 5173 is in use)

---

### 4️⃣ Firebase Console Setup

#### Enable Authentication

1. Firebase Console → Authentication
2. Enable "Email/Password" provider
3. Go to Templates tab
4. Enable "Password reset" email template
5. (Optional) Customize email template

#### Set Authorized Domains

1. Authentication → Settings → Authorized domains
2. Add `localhost` for development
3. Add your production domain when deploying

#### Configure Firestore (if using)

1. Firestore Database → Create database
2. Start in test mode (change rules later)
3. See `SECURITY.md` for production security rules

#### Configure Storage

1. Storage → Get started
2. Start in test mode (change rules later)
3. Security rules will be enforced by backend

---

## 🧪 Testing Setup

### Test SMTP Connection

```bash
cd backend
python test_smtp.py
```

### Test Password Reset

1. Copy template: `cp test-password-reset.template.html test-password-reset-local.html`
2. Edit `test-password-reset-local.html` with your Firebase config
3. Open in browser and test
4. **Do NOT commit the local copy!**

### Test Backend API

```bash
# Terminal 1: Run backend
cd backend
python app_secure.py

# Terminal 2: Test endpoints
curl http://localhost:8000/health
```

---

## 🔐 Security Checklist

Before pushing code:

- [ ] `.env` files are git-ignored
- [ ] `firebase-admin-sdk.json` is git-ignored
- [ ] No hardcoded credentials in code
- [ ] Test files with credentials are local only
- [ ] `.env.example` uses placeholders
- [ ] Read `SECURITY.md` for best practices

---

## 📁 Project Structure

```
vaultify/
├── backend/
│   ├── .env                  # ❌ Git-ignored (your secrets)
│   ├── .env.example          # ✅ Safe template
│   ├── firebase-admin-sdk.json  # ❌ Git-ignored (private key)
│   ├── app_secure.py         # Main Flask app
│   ├── auth.py              # Authentication routes
│   └── requirements.txt      # Python dependencies
│
├── frontend/
│   ├── .env                  # ❌ Git-ignored (your config)
│   ├── .env.example          # ✅ Safe template
│   ├── src/
│   │   ├── App.jsx          # Main app component
│   │   ├── Login.jsx        # Login page
│   │   ├── Register.jsx     # Registration page
│   │   ├── ForgotPassword.jsx  # Password reset
│   │   └── firebase.js      # Firebase client init
│   └── package.json          # Node dependencies
│
├── .gitignore               # Protects sensitive files
├── SECURITY.md              # Security best practices
├── EMAIL_SETUP.md           # Email configuration guide
└── SETUP.md                 # This file
```

---

## 🚨 Common Issues

### Issue: Backend can't start

**Solution:**

- Check `.env` file exists
- Verify `firebase-admin-sdk.json` exists
- Check Python dependencies: `pip install -r requirements.txt`

### Issue: Frontend can't connect to Firebase

**Solution:**

- Check `frontend/.env` has correct values
- Verify Firebase project matches backend
- Restart dev server after `.env` changes

### Issue: Emails not arriving

**Solution:**

- Check spam/junk folder (very common!)
- Verify SMTP credentials in `backend/.env`
- Test SMTP: `python backend/test_smtp.py`
- For password reset: Enable template in Firebase Console

### Issue: Authentication errors

**Solution:**

- Frontend and backend must use same Firebase project
- Check `projectId` matches in both `.env` files
- Verify Firebase Authentication is enabled

---

## 🚀 Deployment

See deployment guides for:

- [Vercel](docs/deploy-vercel.md) (Frontend)
- [Railway](docs/deploy-railway.md) (Backend)
- [Heroku](docs/deploy-heroku.md) (Backend)
- [Firebase Hosting](docs/deploy-firebase.md) (Frontend)

**Production Checklist:**

- Use environment variables (not `.env` files)
- Enable Firebase App Check
- Set proper CORS policies
- Use HTTPS only
- Implement rate limiting
- Enable Firebase Security Rules
- Monitor logs and errors

---

## 📚 Additional Documentation

- [SECURITY.md](SECURITY.md) - Security best practices
- [EMAIL_SETUP.md](EMAIL_SETUP.md) - Email configuration
- [API.md](docs/API.md) - Backend API documentation
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines

---

## 💬 Support

- **Issues:** [GitHub Issues](https://github.com/yourusername/vaultify/issues)
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/vaultify/discussions)
- **Security:** See `SECURITY.md` for reporting vulnerabilities

---

**Happy coding! 🎉**
