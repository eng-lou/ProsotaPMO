"""SMTP delivery tests with no database or network access."""
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
import smtplib

from app.services import access_notification as service


class AccessNotificationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.config = SimpleNamespace(
            smtp_host="smtp.gmail.com", smtp_port=587, smtp_from="sender@example.com",
            smtp_username="sender@example.com", smtp_password="test-only",
            access_request_notify_email="owner@example.com", public_app_url="https://www.prosota.com/",
        )
        self.user = SimpleNamespace(
            id="test-user", display_name="Applicant", email="applicant@example.com",
            requested_title="Planner", requested_organisation="Example",
            status="pending", requested_at=datetime.now(timezone.utc),
            access_notification_sent_at=None, access_notification_attempted_at=None,
        )
        self.db = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock(), rollback=AsyncMock())
        self.db.execute.return_value = MagicMock()
        self.db.execute.return_value.scalar_one_or_none.return_value = self.user

    def test_gmail_uses_tls_before_login_and_send(self):
        message = service.build_message(self.user, self.config)
        self.assertEqual(message["To"], "owner@example.com")
        self.assertIn("applicant@example.com", message.get_content())
        with patch.object(service.smtplib, "SMTP") as connection:
            service.send_message(message, self.config)
            smtp = connection.return_value.__enter__.return_value
            self.assertEqual([c[0] for c in smtp.method_calls], ["starttls", "login", "send_message"])

    async def test_success_is_recorded_and_second_delivery_skipped(self):
        with patch.object(service, "settings", self.config), patch.object(service, "run_in_threadpool", new_callable=AsyncMock) as send:
            self.assertTrue(await service.deliver_access_notification(self.db, self.user.id))
            self.assertFalse(await service.deliver_access_notification(self.db, self.user.id))
            send.assert_awaited_once()
            self.assertIsNotNone(self.user.access_notification_sent_at)

    async def test_smtp_failure_preserves_request_and_throttles_retry(self):
        with patch.object(service, "settings", self.config), patch.object(service, "run_in_threadpool", new_callable=AsyncMock) as send:
            send.side_effect = smtplib.SMTPException("test rejection")
            self.assertFalse(await service.deliver_access_notification(self.db, self.user.id))
            self.assertIsNone(self.user.access_notification_sent_at)
            self.assertEqual(self.user.status, "pending")
            self.assertFalse(await service.deliver_access_notification(self.db, self.user.id))
            send.assert_awaited_once()

    async def test_approved_or_locked_request_is_not_sent(self):
        with patch.object(service, "settings", self.config), patch.object(service, "run_in_threadpool", new_callable=AsyncMock) as send:
            self.user.status = "approved"
            self.assertFalse(await service.deliver_access_notification(self.db, self.user.id))
            self.db.execute.return_value.scalar_one_or_none.return_value = None
            self.assertFalse(await service.deliver_access_notification(self.db, self.user.id))
            send.assert_not_awaited()

    async def test_missing_configuration_leaves_request_pending(self):
        self.config.smtp_host = ""
        with patch.object(service, "settings", self.config):
            self.assertFalse(await service.deliver_access_notification(self.db, self.user.id))
            self.db.execute.assert_not_awaited()
