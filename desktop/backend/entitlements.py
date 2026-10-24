"""Entitlements from a server-verified desktop sign-in identity."""


def desktop_entitlement(identity):
    if not isinstance(identity, dict) or not identity.get("sub"):
        return False
    # New cloud responses carry the authoritative role, including revocation.
    if "is_super_user" in identity:
        return identity["is_super_user"] is True
    # Compatibility with the deployed handoff endpoint, which returns identity
    # but no role. Use the same bootstrap owners as the web application.
    from app.core.config import Settings
    owners = Settings.model_fields["super_user_emails"].default
    email = str(identity.get("email") or "").strip().lower()
    return email in {value.strip().lower() for value in owners.split(",") if value.strip()}
