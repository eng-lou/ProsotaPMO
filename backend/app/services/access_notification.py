"""Durable pending delivery: failures never discard the access request."""
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import logging
import smtplib
import ssl

from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.models.user import User

log = logging.getLogger(__name__)


def build_message(user, config=settings):
    message = EmailMessage()
    message["From"] = config.smtp_from
    message["To"] = config.access_request_notify_email
    message["Subject"] = "Prosota: new access request"
    message["Message-ID"] = f"<access-request-{user.id}@prosota.com>"
    message.set_content(
        f"A user is waiting for access to Prosota.\n\n"
        f"Name: {user.display_name}\nEmail: {user.email}\n"
        f"Title: {user.requested_title or 'Not provided'}\n"
        f"Organisation: {user.requested_organisation or 'Not provided'}\n\n"
        f"Open Access Manager to approve or decline the request:\n"
        f"{config.public_app_url.rstrip('/')}\n"
    )
    return message


def send_message(message, config=settings):
    # Gmail uses smtp.gmail.com:587 with an app password, never the account password.
    with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=15) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        if config.smtp_username:
            smtp.login(config.smtp_username, config.smtp_password)
        smtp.send_message(message)


async def deliver_access_notification(db, user_id):
    if not (settings.smtp_host and settings.smtp_from and settings.public_app_url
            and settings.access_request_notify_email):
        log.warning("Access request email pending: SMTP delivery is not configured")
        return False
    # Skip a concurrent delivery. Retrying the form must not send duplicate emails.
    user = (await db.execute(select(User).where(User.id == user_id)
                            .with_for_update(skip_locked=True))).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if (not user or user.status != "pending" or not user.requested_at
            or user.access_notification_sent_at
            or (user.access_notification_attempted_at
                and user.access_notification_attempted_at > now - timedelta(minutes=5))):
        await db.rollback()
        return False
    user.access_notification_attempted_at = now
    try:
        await run_in_threadpool(send_message, build_message(user))
    except (OSError, smtplib.SMTPException, ValueError):
        # Do not log provider responses, credentials or request personal details.
        log.warning("Access request email delivery failed; request remains pending")
        await db.commit()
        return False
    user.access_notification_sent_at = now
    await db.commit()
    return True
