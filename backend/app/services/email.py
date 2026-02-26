import smtplib
import ssl
import logging
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication

logger = logging.getLogger(__name__)


def send_invitation_email(
    to_email: str,
    project_name: str,
    role: str,
    invite_url: str,
    to_name: str = "",
):
    """
    Send a project invitation email via Gmail SMTP.
    Never raises — failure logs to console and does not block the transaction.
    Must always be called AFTER db.commit().
    """
    try:
        from ..core.config import settings

        if not settings.gmail_app_password:
            print(
                f"[INVITE EMAIL] GMAIL_APP_PASSWORD not set. "
                f"Would have sent to: {to_email} | Project: {project_name} | URL: {invite_url}"
            )
            return

        import re as _re
        greeting = f"Hi {to_name}," if to_name else "Hello,"
        display_url = _re.sub(r'https?://(localhost|127\.0\.0\.1)(:\d+)?', 'https://constructionsightai.com', invite_url)

        html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Project Invitation — ConstructionSight AI</title>
</head>
<body style="margin:0;padding:0;background:#060a12;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#060a12;padding:48px 16px 40px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

        <!-- Brand header -->
        <tr><td align="center" style="padding-bottom:32px;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
            <tr>
              <td style="padding-right:10px;vertical-align:middle;line-height:0;">
                <img src="https://res.cloudinary.com/drtkc6dno/image/upload/v1773519587/logo-abbr_soktmj.png" width="36" height="36" alt="CS" style="display:block;border:0;" />
              </td>
              <td style="vertical-align:middle;line-height:0;">
                <img src="https://res.cloudinary.com/drtkc6dno/image/upload/v1773520763/inverted-logo-image_k9kpl3.png" height="22" alt="ConstructionSight AI" style="display:block;border:0;" />
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#0d1424;border:1px solid #1c2847;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.5);">

          <!-- Accent stripe -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="background:linear-gradient(90deg,#3a56d4 0%,#5b8dee 50%,#3a56d4 100%);height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
          </table>

          <!-- Invitation badge + headline -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="padding:40px 44px 32px;">
              <div style="display:inline-block;">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr><td align="center">
                    <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#5b8dee;background:rgba(91,141,238,0.1);border:1px solid rgba(91,141,238,0.25);padding:5px 14px;border-radius:20px;">
                      Project Invitation
                    </span>
                  </td></tr>
                  <tr><td align="center" style="padding-top:20px;">
                    <h1 style="margin:0;font-size:24px;font-weight:700;color:#e8edf8;line-height:1.3;letter-spacing:-0.02em;">
                      You've been invited to join<br/>a project
                    </h1>
                  </td></tr>
                  <tr><td align="center" style="padding-top:12px;">
                    <p style="margin:0;font-size:14px;color:#7a8aaa;line-height:1.7;max-width:400px;">
                      {greeting}<br/>
                      You've been invited to join the project <strong style="color:#c8d4ee;">{project_name}</strong> on ConstructionSight AI as <strong style="color:#c8d4ee;">{role}</strong>.
                    </p>
                  </td></tr>
                </table>
              </div>
            </td></tr>
          </table>

          <!-- Project details card -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:0 44px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080e1c;border:1px solid #1c2847;border-radius:10px;overflow:hidden;">

                <!-- Section label -->
                <tr><td style="padding:14px 20px 12px;border-bottom:1px solid #1c2847;">
                  <span style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#3d5080;">Invitation Details</span>
                </td></tr>

                <!-- Project row -->
                <tr><td style="padding:16px 20px 14px;border-bottom:1px solid #111a2e;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="vertical-align:top;padding-right:16px;width:20px;">
                        <div style="width:20px;height:20px;background:rgba(91,141,238,0.12);border-radius:5px;text-align:center;line-height:20px;">
                          <span style="font-size:11px;">&#x1F4BC;</span>
                        </div>
                      </td>
                      <td>
                        <span style="display:block;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#3d5080;margin-bottom:3px;">Project</span>
                        <span style="font-size:15px;font-weight:600;color:#dce6f7;">{project_name}</span>
                      </td>
                    </tr>
                  </table>
                </td></tr>

                <!-- Role row -->
                <tr><td style="padding:16px 20px 16px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="vertical-align:top;padding-right:16px;width:20px;">
                        <div style="width:20px;height:20px;background:rgba(91,141,238,0.12);border-radius:5px;text-align:center;line-height:20px;">
                          <span style="font-size:11px;">&#x1F6E1;</span>
                        </div>
                      </td>
                      <td>
                        <span style="display:block;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#3d5080;margin-bottom:3px;">Assigned Role</span>
                        <span style="font-size:15px;font-weight:600;color:#dce6f7;">{role}</span>
                      </td>
                    </tr>
                  </table>
                </td></tr>

              </table>
            </td></tr>
          </table>

          <!-- CTA button -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="padding:0 44px 16px;">
              <p style="margin:0 0 22px;font-size:13px;color:#7a8aaa;line-height:1.7;">
                Accept this invitation to access the project workspace and start collaborating.
              </p>
              <a href="{invite_url}"
                 style="display:inline-block;background:#3a56d4;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:14px 44px;border-radius:9px;letter-spacing:0.08em;text-transform:uppercase;box-shadow:0 4px 20px rgba(58,86,212,0.45);">
                Accept Invitation &rarr;
              </a>
            </td></tr>
          </table>

          <!-- Divider -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:28px 44px 0;"><div style="border-top:1px solid #111a2e;font-size:0;line-height:0;">&nbsp;</div></td></tr>
          </table>

          <!-- Security / fallback section -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:20px 44px;">
              <p style="margin:0 0 10px;font-size:12px;color:#4a5a7a;line-height:1.7;">
                If the button does not work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 16px;word-break:break-all;">
                <a href="{invite_url}" style="font-size:12px;color:#5b8dee;text-decoration:none;">{display_url}</a>
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080e1c;border:1px solid #1c2847;border-radius:8px;">
                <tr><td style="padding:12px 16px;">
                  <p style="margin:0;font-size:12px;color:#4a5a7a;line-height:1.7;">
                    &#x26A0;&#xFE0F;&nbsp; This invitation expires in <strong style="color:#5a6a8a;">7 days</strong>.
                    If you were not expecting this email, no action is required you can safely ignore it.
                  </p>
                </td></tr>
              </table>
            </td></tr>
          </table>

          <!-- Card footer -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080e1c;border-top:1px solid #111a2e;">
            <tr><td style="padding:16px 44px;">
              <p style="margin:0;font-size:11px;color:#4a5a7a;line-height:1.6;">
                This message was sent by ConstructionSight AI on behalf of your project administrator.
                You are receiving this because your email was submitted for a project invitation.
              </p>
            </td></tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="padding-top:28px;">
          <img src="https://res.cloudinary.com/drtkc6dno/image/upload/v1773520763/inverted-logo-image_k9kpl3.png" height="18" alt="ConstructionSight AI" style="display:block;border:0;margin:0 auto;opacity:0.8;" />
          <p style="margin:6px 0 0;font-size:11px;color:#5a6a8a;font-family:'Segoe UI',Arial,sans-serif;">AI Powered Real-time Construction Intelligence Platform</p>
          <p style="margin:6px 0 0;font-size:11px;color:#5a6a8a;font-family:'Segoe UI',Arial,sans-serif;">&copy; 2026 ConstructionSight AI. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

        plain_body = (
            f"{greeting}\n\n"
            f"You've been invited to join \"{project_name}\" on ConstructionSight AI as {role}.\n\n"
            f"Accept your invitation:\n{invite_url}\n\n"
            f"This link expires in 7 days. If you were not expecting this email, you can safely ignore it.\n\n"
            f"ConstructionSight AI — AI Powered Real-time Construction Intelligence Platform"
        )

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"You've been invited as {role} — {project_name}"
        msg["From"] = f"ConstructionSight AI <{settings.gmail_user}>"
        msg["To"] = to_email
        msg.attach(MIMEText(plain_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        context = ssl.create_default_context()
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
            server.login(settings.gmail_user, settings.gmail_app_password)
            server.sendmail(settings.gmail_user, to_email, msg.as_string())

        print(f"[INVITE EMAIL] Sent to {to_email} | Project: {project_name}")

    except Exception as e:
        print(f"[INVITE EMAIL] Failed for {to_email}: {e}")


def send_password_reset_email(to_email: str, otp: str, to_name: str = ""):
    """
    Send a password reset OTP email via Gmail SMTP.
    Never raises — failure logs to console and does not block the transaction.
    Must always be called AFTER db.commit().
    """
    try:
        from ..core.config import settings

        if not settings.gmail_app_password:
            print(
                f"[PASSWORD RESET EMAIL] GMAIL_APP_PASSWORD not set. "
                f"Would have sent OTP {otp} to: {to_email}"
            )
            return

        greeting = f"Hi {to_name}," if to_name else "Hello,"

        html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Password Reset Code — ConstructionSight AI</title>
</head>
<body style="margin:0;padding:0;background:#060a12;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#060a12;padding:48px 16px 40px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

        <!-- Brand header -->
        <tr><td align="center" style="padding-bottom:32px;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
            <tr>
              <td style="padding-right:10px;vertical-align:middle;line-height:0;">
                <img src="https://res.cloudinary.com/drtkc6dno/image/upload/v1773519587/logo-abbr_soktmj.png" width="36" height="36" alt="CS" style="display:block;border:0;" />
              </td>
              <td style="vertical-align:middle;line-height:0;">
                <img src="https://res.cloudinary.com/drtkc6dno/image/upload/v1773520763/inverted-logo-image_k9kpl3.png" height="22" alt="ConstructionSight AI" style="display:block;border:0;" />
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#0d1424;border:1px solid #1c2847;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.5);">

          <!-- Accent stripe -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="background:linear-gradient(90deg,#3a56d4 0%,#5b8dee 50%,#3a56d4 100%);height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
          </table>

          <!-- Badge + headline -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="padding:40px 44px 32px;">
              <div style="display:inline-block;">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr><td align="center">
                    <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#5b8dee;background:rgba(91,141,238,0.1);border:1px solid rgba(91,141,238,0.25);padding:5px 14px;border-radius:20px;">
                      Password Reset Code
                    </span>
                  </td></tr>
                  <tr><td align="center" style="padding-top:20px;">
                    <h1 style="margin:0;font-size:24px;font-weight:700;color:#e8edf8;line-height:1.3;letter-spacing:-0.02em;">
                      Reset your password
                    </h1>
                  </td></tr>
                  <tr><td align="center" style="padding-top:12px;">
                    <p style="margin:0;font-size:14px;color:#7a8aaa;line-height:1.7;max-width:400px;">
                      {greeting}<br/>
                      We received a request to reset your ConstructionSight account password.
                    </p>
                  </td></tr>
                </table>
              </div>
            </td></tr>
          </table>

          <!-- OTP code display -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:0 44px 32px;" align="center">
              <div style="background:#080e1c;border:1px solid #1c2847;border-radius:10px;padding:32px;text-align:center;">
                <p style="margin:0 0 16px;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#3d5080;">Your Verification Code</p>
                <p style="margin:0;font-size:36px;font-weight:700;color:#5b8dee;letter-spacing:0.2em;font-family:monospace;">{otp}</p>
                <p style="margin:16px 0 0;font-size:11px;color:#4a5a7a;">This code will expire in 10 minutes</p>
              </div>
            </td></tr>
          </table>

          <!-- Instructions -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:0 44px 28px;">
              <p style="margin:0 0 12px;font-size:13px;color:#7a8aaa;line-height:1.7;">
                Enter this code in the password reset form to verify your identity and set a new password.
              </p>
            </td></tr>
          </table>

          <!-- Security warning -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:0 44px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080e1c;border:1px solid #1c2847;border-radius:8px;">
                <tr><td style="padding:12px 16px;">
                  <p style="margin:0;font-size:12px;color:#4a5a7a;line-height:1.7;">
                    ⚠️&nbsp; If you did not request this password reset, you can safely ignore this email. Your password will not change unless you complete the reset process.
                  </p>
                </td></tr>
              </table>
            </td></tr>
          </table>

          <!-- Card footer -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080e1c;border-top:1px solid #111a2e;">
            <tr><td style="padding:16px 44px;">
              <p style="margin:0;font-size:11px;color:#4a5a7a;line-height:1.6;">
                This is an automated message from ConstructionSight AI. Please do not reply to this email.
              </p>
            </td></tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="padding-top:28px;">
          <img src="https://res.cloudinary.com/drtkc6dno/image/upload/v1773520763/inverted-logo-image_k9kpl3.png" height="18" alt="ConstructionSight AI" style="display:block;border:0;margin:0 auto;opacity:0.8;" />
          <p style="margin:6px 0 0;font-size:11px;color:#5a6a8a;font-family:'Segoe UI',Arial,sans-serif;">AI Powered Real-time Construction Intelligence Platform</p>
          <p style="margin:6px 0 0;font-size:11px;color:#5a6a8a;font-family:'Segoe UI',Arial,sans-serif;">&copy; 2026 ConstructionSight AI. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

        plain_body = (
            f"{greeting}\n\n"
            f"We received a request to reset your ConstructionSight account password.\n\n"
            f"Your verification code is: {otp}\n\n"
            f"This code will expire in 10 minutes.\n\n"
            f"If you did not request this password reset, you can safely ignore this email.\n\n"
            f"ConstructionSight AI — AI Powered Real-time Construction Intelligence Platform"
        )

        msg = MIMEMultipart("alternative")
        msg["Subject"] = "ConstructionSight AI Password Reset Code"
        msg["From"] = f"ConstructionSight AI <{settings.gmail_user}>"
        msg["To"] = to_email
        msg.attach(MIMEText(plain_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        context = ssl.create_default_context()
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
            server.login(settings.gmail_user, settings.gmail_app_password)
            server.sendmail(settings.gmail_user, to_email, msg.as_string())

        print(f"[PASSWORD RESET EMAIL] Sent to {to_email}")

    except Exception as e:
        print(f"[PASSWORD RESET EMAIL] Failed for {to_email}: {e}")


def send_report_email(
    recipients: list,       # list of {email, name, role}
    project_name: str,
    period_label: str,
    period_start: datetime,
    period_end: datetime,
    pdf_bytes: bytes,
    download_url: str = "",
) -> dict:
    """
    Send the PPE Safety Report PDF to a list of recipients.

    Sends individually to each recipient (not BCC — enterprise compliance standard).
    Never raises — failures are logged and returned in the result dict.

    Returns: {"sent": int, "failed": [email, ...]}

    Must be called AFTER db.commit() (email is non-transactional).
    """
    from ..core.config import settings

    sent = 0
    failed = []

    role_labels = {
        "project_manager": "Project Manager",
        "site_supervisor": "Site Supervisor",
        "safety_officer": "Safety Officer",
        "data_analyst": "Data Analyst",
        "stakeholder": "Stakeholder",
    }

    period_fmt = f"{period_start.strftime('%B %d, %Y')} — {period_end.strftime('%B %d, %Y')}"
    pdf_filename = f"PPE_Safety_Report_{project_name.replace(' ', '_')}_{period_label}.pdf"
    subject = f"[ConstructionSight AI] PPE Safety Report — {project_name} | {period_label}"

    if not settings.gmail_app_password:
        logger.warning(
            f"[REPORT EMAIL] GMAIL_APP_PASSWORD not set. Would have sent to {len(recipients)} recipients. "
            f"Project: {project_name} | Period: {period_label}"
        )
        # Treat as "sent" when email is not configured (dev mode)
        return {"sent": len(recipients), "failed": []}

    for recipient in recipients:
        to_email = recipient.get("email", "")
        to_name  = recipient.get("name", "")
        role     = recipient.get("role", "")
        role_label = role_labels.get(role, role.replace("_", " ").title())
        greeting = f"Hi {to_name}," if to_name else "Hello,"

        try:
            html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>PPE Safety Report — ConstructionSight AI</title>
</head>
<body style="margin:0;padding:0;background:#060a12;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#060a12;padding:48px 16px 40px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

        <!-- Brand header -->
        <tr><td align="center" style="padding-bottom:32px;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
            <tr>
              <td style="padding-right:10px;vertical-align:middle;line-height:0;">
                <img src="https://res.cloudinary.com/drtkc6dno/image/upload/v1773519587/logo-abbr_soktmj.png" width="36" height="36" alt="CS" style="display:block;border:0;" />
              </td>
              <td style="vertical-align:middle;line-height:0;">
                <img src="https://res.cloudinary.com/drtkc6dno/image/upload/v1773520763/inverted-logo-image_k9kpl3.png" height="22" alt="ConstructionSight AI" style="display:block;border:0;" />
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#0d1424;border:1px solid #1c2847;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.5);">

          <!-- Accent stripe -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="background:linear-gradient(90deg,#3a56d4 0%,#5b8dee 50%,#3a56d4 100%);height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
          </table>

          <!-- Badge + headline -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="padding:40px 44px 24px;">
              <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#5b8dee;background:rgba(91,141,238,0.1);border:1px solid rgba(91,141,238,0.25);padding:5px 14px;border-radius:20px;">
                PPE Safety Report
              </span>
              <h1 style="margin:20px 0 8px;font-size:22px;font-weight:700;color:#e8edf8;line-height:1.3;letter-spacing:-0.02em;">
                Your safety report is ready
              </h1>
              <p style="margin:0;font-size:14px;color:#7a8aaa;line-height:1.7;">
                {greeting}<br/>
                Your scheduled PPE safety report for <strong style="color:#c8d4ee;">{project_name}</strong> is attached.
              </p>
            </td></tr>
          </table>

          <!-- Report details card -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:0 44px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080e1c;border:1px solid #1c2847;border-radius:10px;overflow:hidden;">

                <tr><td style="padding:14px 20px 12px;border-bottom:1px solid #1c2847;">
                  <span style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#3d5080;">Report Details</span>
                </td></tr>

                <tr><td style="padding:14px 20px;border-bottom:1px solid #111a2e;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="width:20px;vertical-align:top;padding-right:12px;">
                        <div style="width:20px;height:20px;background:rgba(91,141,238,0.12);border-radius:5px;text-align:center;line-height:20px;font-size:11px;">&#x1F4CA;</div>
                      </td>
                      <td>
                        <span style="display:block;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#3d5080;margin-bottom:3px;">Period</span>
                        <span style="font-size:14px;font-weight:600;color:#dce6f7;">{period_fmt}</span>
                      </td>
                    </tr>
                  </table>
                </td></tr>

                <tr><td style="padding:14px 20px;border-bottom:1px solid #111a2e;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="width:20px;vertical-align:top;padding-right:12px;">
                        <div style="width:20px;height:20px;background:rgba(91,141,238,0.12);border-radius:5px;text-align:center;line-height:20px;font-size:11px;">&#x1F3D7;</div>
                      </td>
                      <td>
                        <span style="display:block;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#3d5080;margin-bottom:3px;">Project</span>
                        <span style="font-size:14px;font-weight:600;color:#dce6f7;">{project_name}</span>
                      </td>
                    </tr>
                  </table>
                </td></tr>

                <tr><td style="padding:14px 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="width:20px;vertical-align:top;padding-right:12px;">
                        <div style="width:20px;height:20px;background:rgba(91,141,238,0.12);border-radius:5px;text-align:center;line-height:20px;font-size:11px;">&#x1F6E1;</div>
                      </td>
                      <td>
                        <span style="display:block;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#3d5080;margin-bottom:3px;">Your Role</span>
                        <span style="font-size:14px;font-weight:600;color:#dce6f7;">{role_label}</span>
                      </td>
                    </tr>
                  </table>
                </td></tr>

              </table>
            </td></tr>
          </table>

          <!-- Attachment notice -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:0 44px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080e1c;border:1px solid #1c2847;border-radius:8px;">
                <tr><td style="padding:14px 18px;">
                  <p style="margin:0;font-size:13px;color:#7a8aaa;line-height:1.7;">
                    &#x1F4CE;&nbsp; <strong style="color:#c8d4ee;">{pdf_filename}</strong> is attached to this email.
                    Open it in any PDF viewer or print it for records.
                  </p>
                </td></tr>
              </table>
            </td></tr>
          </table>

          <!-- CTA button -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="padding:0 44px 28px;">
              <a href="{download_url}"
                 style="display:inline-block;background:#3a56d4;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:13px 40px;border-radius:9px;letter-spacing:0.08em;text-transform:uppercase;box-shadow:0 4px 20px rgba(58,86,212,0.45);">
                View in Dashboard &rarr;
              </a>
            </td></tr>
          </table>

          <!-- Divider -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:0 44px;"><div style="border-top:1px solid #111a2e;font-size:0;line-height:0;">&nbsp;</div></td></tr>
          </table>

          <!-- Footer note -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080e1c;border-top:1px solid #111a2e;">
            <tr><td style="padding:16px 44px;">
              <p style="margin:0;font-size:11px;color:#4a5a7a;line-height:1.6;">
                You are receiving this report as a <strong>{role_label}</strong> on <strong>{project_name}</strong>.
                To change report frequency or preferences, contact your Project Manager.
              </p>
            </td></tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="padding-top:28px;">
          <img src="https://res.cloudinary.com/drtkc6dno/image/upload/v1773520763/inverted-logo-image_k9kpl3.png" height="18" alt="ConstructionSight AI" style="display:block;border:0;margin:0 auto;opacity:0.8;" />
          <p style="margin:6px 0 0;font-size:11px;color:#5a6a8a;">&copy; 2026 ConstructionSight AI. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

            plain_body = (
                f"{greeting}\n\n"
                f"Your PPE Safety Report for {project_name} (Period: {period_fmt}) is attached.\n\n"
                f"File: {pdf_filename}\n\n"
                f"View in dashboard: {download_url}\n\n"
                f"You are receiving this as {role_label} on {project_name}.\n\n"
                f"ConstructionSight AI — AI Powered Real-time Construction Intelligence Platform"
            )

            msg = MIMEMultipart("mixed")
            msg["Subject"] = subject
            msg["From"]    = f"ConstructionSight AI <{settings.gmail_user}>"
            msg["To"]      = to_email

            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(plain_body, "plain"))
            alt.attach(MIMEText(html_body, "html"))
            msg.attach(alt)

            # Attach PDF
            pdf_attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
            pdf_attachment.add_header("Content-Disposition", "attachment", filename=pdf_filename)
            msg.attach(pdf_attachment)

            context = ssl.create_default_context()
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
                server.login(settings.gmail_user, settings.gmail_app_password)
                server.sendmail(settings.gmail_user, to_email, msg.as_string())

            sent += 1
            logger.info(f"[REPORT EMAIL] Sent to {to_email} | Project: {project_name} | Period: {period_label}")

        except Exception as e:
            failed.append(to_email)
            logger.error(f"[REPORT EMAIL] Failed for {to_email}: {e}")

    return {"sent": sent, "failed": failed}
