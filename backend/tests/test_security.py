from app.core.security import (
    create_access_token, decode_access_token, hash_password, hash_token, new_refresh_token, verify_password,
)
from app.services.chat import validate_payload
import pytest

CID = "123e4567-e89b-12d3-a456-426614174000"


def test_password_roundtrip():
    h = hash_password("correct horse battery")
    assert verify_password(h, "correct horse battery")
    assert not verify_password(h, "wrong")
    assert not verify_password("not-a-hash", "x")


def test_access_token_roundtrip():
    assert decode_access_token(create_access_token(42)) == 42
    assert decode_access_token("garbage") is None


def test_refresh_token_hash_matches():
    raw, hashed = new_refresh_token()
    assert hash_token(raw) == hashed and len(hashed) == 64


def test_validate_text_payload():
    assert validate_payload({"client_id": CID, "content": "  hi  "}) == ("text", "hi", None)


@pytest.mark.parametrize(
    "data",
    [
        {"client_id": "nope", "content": "hi"},
        {"client_id": CID, "content": "   "},
        {"client_id": CID, "content": "x" * 5000},
        {"client_id": CID, "kind": "image"},
        {"client_id": CID, "kind": "image", "attachment": {"url": "http://evil/x.png", "mime_type": "image/png", "size_bytes": 1}},
        {"client_id": CID, "kind": "image", "attachment": {"url": "/files/../etc/passwd", "mime_type": "image/png", "size_bytes": 1}},
    ],
)
def test_validate_rejects_bad_payloads(data):
    with pytest.raises(ValueError):
        validate_payload(data)


def test_validate_image_payload():
    att = {"url": "/files/a.png", "mime_type": "image/png", "size_bytes": 10, "filename": "a.png"}
    kind, content, attachment = validate_payload({"client_id": CID, "kind": "image", "attachment": att})
    assert kind == "image" and content is None and attachment == att
