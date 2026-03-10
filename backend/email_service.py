import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

GMAIL_ADDRESS      = os.getenv("GMAIL_ADDRESS", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


def _send(to_email: str, subject: str, html_body: str) -> bool:
    """Low-level send.  Returns True on success, False on failure."""
    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD:
        print("[email_service] GMAIL_ADDRESS or GMAIL_APP_PASSWORD not set — skipping email.")
        return False

    msg = MIMEMultipart("alternative")
    msg["From"]    = f"Vaultify <{GMAIL_ADDRESS}>"
    msg["To"]      = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_ADDRESS, to_email, msg.as_string())
        print(f"[email_service] ✅ Sent to {to_email}: {subject}")
        return True
    except Exception as e:
        print(f"[email_service] ❌ Failed to send to {to_email}: {e}")
        return False


# ── Public helpers ────────────────────────────────────────────────

def send_share_notification(
    to_email: str,
    sharer_name: str,
    resource_name: str,
    resource_type: str,
    permission: str,
) -> bool:
    """Notify a user that something has been shared with them."""
    perm_label = "view" if permission == "viewer" else "view & download"
    kind       = "folder" if resource_type == "client" else "document"

    subject = f"{sharer_name} shared a {kind} with you on Vaultify"

    html = f"""
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;
                border:1px solid #e2e8f0;border-radius:16px;background:#fafafa;">
      <div style="text-align:center;margin-bottom:20px;">
        <span style="font-weight:800;letter-spacing:2px;font-size:14px;color:#0f172a;">VAULTIFY</span>
      </div>
      <h2 style="font-size:18px;color:#0f172a;margin:0 0 8px;">
        {sharer_name} shared a {kind} with you
      </h2>
      <p style="font-size:14px;color:#475569;margin:0 0 16px;">
        <strong>{resource_name.replace('_', ' ')}</strong> — you can <strong>{perm_label}</strong>.
      </p>
      <a href="#" style="display:inline-block;padding:10px 24px;background:#0ea5e9;color:#fff;
                         border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">
        Open in Vaultify
      </a>
      <p style="font-size:12px;color:#94a3b8;margin-top:20px;">
        If you don't have a Vaultify account yet, sign up with <strong>{to_email}</strong>
        and it will appear in your "Shared with me" section automatically.
      </p>
    </div>
    """

    return _send(to_email, subject, html)


def send_share_revoked_notification(
    to_email: str,
    revoker_name: str,
    resource_name: str,
    resource_type: str,
) -> bool:
    """Notify a user that a share has been revoked."""
    kind = "folder" if resource_type == "client" else "document"

    subject = f"Access removed: {resource_name.replace('_', ' ')} on Vaultify"

    html = f"""
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;
                border:1px solid #e2e8f0;border-radius:16px;background:#fafafa;">
      <div style="text-align:center;margin-bottom:20px;">
        <span style="font-weight:800;letter-spacing:2px;font-size:14px;color:#0f172a;">VAULTIFY</span>
      </div>
      <h2 style="font-size:18px;color:#0f172a;margin:0 0 8px;">
        Access to a {kind} was removed
      </h2>
      <p style="font-size:14px;color:#475569;margin:0 0 16px;">
        <strong>{revoker_name}</strong> removed your access to
        <strong>{resource_name.replace('_', ' ')}</strong>.
      </p>
      <p style="font-size:12px;color:#94a3b8;margin-top:20px;">
        You will no longer see this item in your "Shared with me" section.
      </p>
    </div>
    """

    return _send(to_email, subject, html)
