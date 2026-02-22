import firebase_admin
from firebase_admin import auth as firebase_auth
import firebase_init

firebase_init._init()

print("\n" + "="*60)
print("  Firebase Password Reset Diagnostic Tool")
print("="*60 + "\n")

# Test 1: Check Firebase connection
print("✓ Firebase Admin SDK initialized")
print(f"  Project: {firebase_admin.get_app().project_id}\n")

# Test 2: List users
try:
    print("📋 Checking registered users...")
    users = firebase_auth.list_users().iterate_all()
    user_list = list(users)
    
    if not user_list:
        print("❌ NO USERS REGISTERED!")
        print("   → You must create an account first before testing password reset\n")
    else:
        print(f"✓ Found {len(user_list)} registered user(s):\n")
        for user in user_list:
            print(f"   Email: {user.email}")
            print(f"   UID:   {user.uid}")
            print(f"   Email Verified: {user.email_verified}")
            print()
except Exception as e:
    print(f"❌ Error listing users: {e}\n")

# Test 3: Generate password reset link for testing
print("\n" + "-"*60)
print("🔗 Testing Password Reset Link Generation")
print("-"*60 + "\n")

test_email = input("Enter an email to test password reset (or press Enter to skip): ").strip()

if test_email:
    try:
        # Try to get user
        user = firebase_auth.get_user_by_email(test_email)
        print(f"\n✓ User found: {test_email}")
        
        # Generate password reset link (Admin SDK way)
        action_link = firebase_auth.generate_password_reset_link(
            test_email,
            action_code_settings=firebase_auth.ActionCodeSettings(
                url='http://localhost:5174/login',
                handle_code_in_app=False,
            )
        )
        
        print(f"\n✅ Password reset link generated successfully!")
        print(f"\n🔗 Reset Link (Firebase will send this via email):")
        print(f"{action_link}\n")
        print("NOTE: This link was generated, but Firebase needs to SEND it via email.")
        print("      Check the Firebase Console email template settings.\n")
        
    except firebase_auth.UserNotFoundError:
        print(f"\n❌ No user found with email: {test_email}")
        print("   Register an account first!\n")
    except Exception as e:
        print(f"\n❌ Error: {e}\n")

print("\n" + "="*60)
print("  TROUBLESHOOTING CHECKLIST")
print("="*60 + "\n")

print("□ 1. Email template enabled in Firebase Console")
print("    → https://console.firebase.google.com/project/vaultify-54eb7/authentication/emails")
print("    → Click 'Password reset' and verify it's enabled\n")

print("□ 2. User account exists")
print("    → Register an account first via your app\n")

print("□ 3. Check spam/junk folder")
print("    → Firebase emails often go to spam initially\n")

print("□ 4. Authorized domains configured")
print("    → https://console.firebase.google.com/project/vaultify-54eb7/authentication/settings")
print("    → Make sure 'localhost' is in the authorized domains list\n")

print("□ 5. Wait 1-3 minutes for email delivery\n")

print("□ 6. Check Firebase email sending quota")
print("    → Free tier: 100 emails/day\n")

print("="*60 + "\n")
