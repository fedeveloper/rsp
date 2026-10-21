from app.auth import is_expired


def test_rejects_expired_token():
    assert is_expired("2020-01-01")
