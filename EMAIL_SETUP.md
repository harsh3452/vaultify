# Email Configuration & Troubleshooting Guide

## 🎯 Overview

Vaultify uses two email systems:

1. **Firebase Auth** - For password reset emails (handled by Google)
2. **SMTP (Gmail)** - For OTP verification emails (backend/auth.py)

---

## 📧 Email Systems

### 1. Password Reset Emails (Firebase)

**Sender:** `noreply@vaultify-54eb7.firebaseapp.com`  
**Component:** `frontend/src/ForgotPassword.jsx`  
**Configuration:** Firebase Console → Authentication → Templates

#### Setup Steps:

1. Go to [Firebase Console](https://console.firebase.google.com/project/vaultify-54eb7/authentication/emails)
2. Click **Templates** tab
3. Enable **Password reset** template
4. (Optional) Customize subject and body

#### Common Issues:

- ✅ Emails go to **spam folder** (normal for Firebase emails)
- ✅ Users must check spam/junk folder
- ✅ Takes 1-3 minutes to arrive

#### To Prevent Spam:

For Gmail users:

1. Mark Firebase emails as "Not Spam"
2. Add `noreply@vaultify-54eb7.firebaseapp.com` to contacts
3. Create filter: Settings → Filters → Never send to Spam

---

### 2. OTP Verification Emails (SMTP)

**Sender:** `Vaultify <pendhari321karan@gmail.com>`  
**Component:** `backend/auth.py` → `/auth/send-otp`  
**Configuration:** `backend/.env`

#### SMTP Configuration:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=pendhari321karan@gmail.com
SMTP_PASSWORD=your-16-char-app-password
SMTP_FROM=Vaultify <pendhari321karan@gmail.com>
```

#### Gmail App Password Setup:

1. Enable 2-Step Verification on Gmail account
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Generate App Password for "Mail"
4. Copy 16-character password to `SMTP_PASSWORD` in `.env`
5. Restart backend server

#### Test SMTP:

```bash
cd backend
python test_smtp.py
```

#### Common Issues:

- ❌ `SMTP_PASSWORD` not set → Check `.env` file
- ❌ Backend not restarted → Restart after `.env` changes
- ❌ Authentication failed → Regenerate App Password
- ✅ Emails may go to spam initially

---

## 🔧 Troubleshooting

### Password Reset Not Working

**Check Firebase Configuration:**

```bash
# Frontend should use vaultify-54eb7
# Check: frontend/.env
VITE_FIREBASE_PROJECT_ID=vaultify-54eb7
VITE_FIREBASE_AUTH_DOMAIN=vaultify-54eb7.firebaseapp.com
```

**Test Reset Email:**

1. Open `test-password-reset-debug.html` in browser
2. Select user email
3. Click "Send Password Reset Email"
4. Check debug log for errors
5. Check spam folder

**Common Errors:**

- `auth/user-not-found` → Register account first
- `auth/invalid-email` → Check email format
- `auth/unauthorized-domain` → Add `localhost` to Firebase authorized domains

### OTP Emails Not Working

**Check SMTP Credentials:**

```bash
cd backend
Get-Content .env | Select-String "SMTP"
```

**Test SMTP Connection:**

```bash
cd backend
python test_smtp.py
```

**Common Fixes:**

1. Verify `SMTP_PASSWORD` is set (not `SMTP_PASS`)
2. Regenerate Gmail App Password if authentication fails
3. Restart backend server after `.env` changes
4. Check spam/junk folder

---

## 📝 User Instructions

### For Password Reset:

1. Click "Forgot Password?" on login page
2. Enter email address
3. Check email inbox (within 1-3 minutes)
4. **Check spam/junk folder** if not in inbox
5. Click reset link
6. Enter new password on Firebase page
7. Return to app and login

### For OTP Verification:

1. Register with email and password
2. Check email for 6-digit code
3. **Check spam/junk folder** if not in inbox
4. Enter code on verification page
5. Account created after successful verification

---

## 🚀 Production Deployment

### Firebase Email Template Customization:

1. Add company logo
2. Customize email body and subject
3. Use custom email action URL
4. Consider custom domain for better deliverability

### SMTP for Production:

Consider using:

- **SendGrid** - 100 emails/day free
- **Amazon SES** - 62,000 emails/month free
- **Mailgun** - 5,000 emails/month free
- **Resend** - Modern email API (code already in auth.py)

### Email Deliverability Tips:

1. Use proper SPF/DKIM/DMARC records
2. Add custom domain to Firebase
3. Monitor spam complaints
4. Add unsubscribe links
5. Use email verification services

---

## 📊 Testing Files

- `test-password-reset.html` - Basic Firebase reset test
- `test-password-reset-debug.html` - Comprehensive debug tool with logging
- `backend/test_smtp.py` - SMTP connection test
- `backend/test_password_reset.py` - Firebase Admin SDK test

---

## 🔐 Security Notes

- Never commit `.env` files to git
- Rotate SMTP passwords regularly
- Use Firebase App Check in production
- Monitor authentication logs
- Set up rate limiting for email endpoints
- Implement CAPTCHA for public endpoints

---

## 📞 Support Resources

- Firebase Console: https://console.firebase.google.com/project/vaultify-54eb7
- Firebase Auth Emails: https://console.firebase.google.com/project/vaultify-54eb7/authentication/emails
- Gmail App Passwords: https://myaccount.google.com/apppasswords
- Firebase Documentation: https://firebase.google.com/docs/auth

---

**Last Updated:** February 22, 2026  
**Project:** Vaultify - AI-Powered KYC Document Vault
