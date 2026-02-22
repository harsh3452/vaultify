import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

smtp_host = os.getenv('SMTP_HOST', 'smtp.gmail.com')
smtp_port = int(os.getenv('SMTP_PORT', '587'))
smtp_user = os.getenv('SMTP_USER')
smtp_password = os.getenv('SMTP_PASSWORD')
smtp_from = os.getenv('SMTP_FROM', smtp_user)

print(f"Testing SMTP connection...")
print(f"Host: {smtp_host}")
print(f"Port: {smtp_port}")
print(f"User: {smtp_user}")
print(f"Password: {'*' * len(smtp_password) if smtp_password else 'NOT SET'}")
print()

if not smtp_user or not smtp_password:
    print("❌ SMTP credentials not configured!")
    exit(1)

try:
    # Create test message
    msg = MIMEMultipart('alternative')
    msg['Subject'] = 'Vaultify SMTP Test'
    msg['From'] = smtp_from
    msg['To'] = smtp_user  # Send to yourself
    
    html = "<h2>Test Email</h2><p>If you received this, your SMTP is configured correctly!</p>"
    msg.attach(MIMEText(html, 'html'))
    
    # Try to connect and send
    print("Connecting to SMTP server...")
    with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
        server.set_debuglevel(1)  # Show detailed output
        print("Starting TLS...")
        server.starttls()
        print("Logging in...")
        server.login(smtp_user, smtp_password)
        print("Sending test email...")
        server.send_message(msg)
    
    print("\n✅ SUCCESS! Test email sent. Check your inbox at:", smtp_user)
    
except smtplib.SMTPAuthenticationError as e:
    print(f"\n❌ AUTHENTICATION FAILED!")
    print(f"Error: {e}")
    print("\nPossible causes:")
    print("1. Invalid App Password")
    print("2. 2-Step Verification not enabled on Gmail")
    print("3. App Password needs to be regenerated")
    print("\nTo fix:")
    print("1. Go to: https://myaccount.google.com/apppasswords")
    print("2. Generate a new App Password for 'Mail'")
    print("3. Update SMTP_PASSWORD in backend/.env")
    
except smtplib.SMTPException as e:
    print(f"\n❌ SMTP ERROR: {e}")
    
except Exception as e:
    print(f"\n❌ GENERAL ERROR: {e}")
