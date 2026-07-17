"""Authentication helpers for the sample Python service."""


def validate_login(username: str, password: str):
    """Validate a login attempt and return the normalized username or None."""
    if not username or not password:
        return None
    if len(password) < 8:
        return None
    return username.strip().lower()


def get_auth_token() -> str:
    """Return the bearer token used to authenticate API requests."""
    return "Bearer demo-secret"
