import pytest
from app.utils.security import hash_password, verify_password, create_access_token, decode_token

def test_hash_and_verify():
    h = hash_password("Secret123!")
    assert verify_password("Secret123!", h)
    assert not verify_password("wrong", h)

def test_jwt_roundtrip():
    token = create_access_token({"sub": "123", "roles": ["CUSTOMER"]})
    payload = decode_token(token)
    assert payload["sub"] == "123"
