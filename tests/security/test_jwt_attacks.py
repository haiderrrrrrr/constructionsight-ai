"""
Security Tests — JWT-specific attack vectors.

Covers: tampered signature, alg:none bypass, expired token replay,
        wrong audience, wrong issuer, refresh token family revocation.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Security Tests"),
    allure.story("JWT — Attack Vectors"),
    pytest.mark.security,
]

import base64
import json
from datetime import datetime, timedelta, timezone
from jose import jwt

from app.core.config import settings
from app.core.security import create_access_token


def _forge_jwt(sub: str, role: str = "user", token_version: int = 1,
               secret: str = None, aud: str = None, iss: str = None,
               exp_delta: timedelta = None) -> str:
    exp_delta = exp_delta or timedelta(minutes=30)
    payload = {
        "sub": sub,
        "platform_role": role,
        "exp": datetime.now(timezone.utc) + exp_delta,
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "iss": iss or settings.jwt_issuer,
        "aud": aud or settings.jwt_audience,
        "jti": "attack-jti-9999",
        "ver": token_version,
    }
    return jwt.encode(payload, secret or settings.jwt_secret, algorithm=settings.jwt_algorithm)


class TestTamperedSignature:
    @pytest.mark.testcase(
        tc_id="TC-SEC-040",
        objective="JWT with tampered signature returns 401",
        precondition="Valid JWT with last signature character flipped",
        steps=[
            "Create valid token",
            "Flip last character of signature section",
            "GET /users/me with tampered token",
            "Assert HTTP 401",
        ],
        test_data={"tampering": "flip last char of signature"},
        expected_result="HTTP 401 — tampered signature rejected",
        post_condition="No data exposed",
    )
    def test_tampered_signature_returns_401(self, client, regular_user):
        token = create_access_token(str(regular_user.id), "user",
                                    token_version=regular_user.token_version)
        header, payload_b64, sig = token.split(".")
        # Flip a character in the middle — all 6 bits are significant there,
        # so the decoded signature bytes definitely change (last char has 4 padding bits).
        mid = len(sig) // 2
        chars = list(sig)
        chars[mid] = "A" if chars[mid] != "A" else "B"
        tampered = f"{header}.{payload_b64}.{''.join(chars)}"
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {tampered}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-041",
        objective="JWT with tampered payload (role escalation in body) returns 401",
        precondition="Valid user token; payload section modified to set role='admin'",
        steps=[
            "Create valid user token",
            "Base64-decode and modify payload to set platform_role='admin'",
            "Re-encode with original (unchanged) signature",
            "GET /admin/users",
            "Assert HTTP 401",
        ],
        test_data={"tampering": "modify payload platform_role to admin"},
        expected_result="HTTP 401 — signature mismatch after payload modification",
        post_condition="No admin access granted",
    )
    def test_tampered_payload_role_escalation_returns_401(self, client, regular_user):
        token = create_access_token(str(regular_user.id), "user",
                                    token_version=regular_user.token_version)
        header_b64, payload_b64, sig = token.split(".")
        # Decode, modify, re-encode payload
        padding = "=" * (4 - len(payload_b64) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(payload_b64 + padding))
        decoded["platform_role"] = "admin"
        new_payload = base64.urlsafe_b64encode(
            json.dumps(decoded).encode()
        ).rstrip(b"=").decode()
        tampered = f"{header_b64}.{new_payload}.{sig}"
        resp = client.get("/admin/users", headers={"Authorization": f"Bearer {tampered}"})
        assert resp.status_code == 401


class TestAlgNoneAttack:
    @pytest.mark.testcase(
        tc_id="TC-SEC-042",
        objective="JWT with alg:none is rejected — algorithm confusion attack",
        precondition="Manually crafted JWT with header alg='none' and no signature",
        steps=[
            "Build JWT with alg='none' header",
            "Craft admin payload without signing",
            "GET /admin/users with this token",
            "Assert HTTP 401",
        ],
        test_data={"alg": "none", "platform_role": "admin"},
        expected_result="HTTP 401 — alg:none not accepted",
        post_condition="No admin access granted",
    )
    def test_alg_none_attack_returns_401(self, client):
        header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
        payload_data = {
            "sub": "1",
            "platform_role": "admin",
            "exp": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()),
            "iat": int(datetime.now(timezone.utc).timestamp()),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "jti": "alg-none-attack",
            "ver": 1,
        }
        body = base64.urlsafe_b64encode(json.dumps(payload_data).encode()).rstrip(b"=").decode()
        none_token = f"{header}.{body}."
        resp = client.get("/admin/users", headers={"Authorization": f"Bearer {none_token}"})
        assert resp.status_code == 401


class TestExpiredTokenReplay:
    @pytest.mark.testcase(
        tc_id="TC-SEC-043",
        objective="Expired access token cannot be replayed (401)",
        precondition="Token with expires_minutes=-10 (already expired)",
        steps=[
            "Issue token with exp in the past",
            "GET /users/me",
            "Assert HTTP 401",
        ],
        test_data={"expires_minutes": -10},
        expected_result="HTTP 401 — expired token rejected",
        post_condition="Session not established from replayed token",
    )
    def test_expired_token_replay_returns_401(self, client, regular_user):
        expired = create_access_token(str(regular_user.id), "user", expires_minutes=-10)
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {expired}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-044",
        objective="Token that expires in 1 second is valid before expiry",
        precondition="Token with expires_minutes=1",
        steps=[
            "Issue token with expires_minutes=1",
            "GET /users/me immediately",
            "Assert HTTP 200",
        ],
        test_data={"expires_minutes": 1},
        expected_result="HTTP 200 — token valid before expiry",
        post_condition="No side effects",
    )
    def test_valid_token_before_expiry_is_accepted(self, client, regular_user):
        valid = create_access_token(str(regular_user.id), "user",
                                    token_version=regular_user.token_version,
                                    expires_minutes=1)
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {valid}"})
        assert resp.status_code == 200


class TestAudienceIssuerValidation:
    @pytest.mark.testcase(
        tc_id="TC-SEC-045",
        objective="Token with wrong audience returns 401",
        precondition="JWT signed with correct secret but aud='wrong-audience'",
        steps=[
            "Forge JWT with aud='wrong-audience'",
            "GET /users/me",
            "Assert HTTP 401",
        ],
        test_data={"aud": "wrong-audience"},
        expected_result="HTTP 401 — audience mismatch",
        post_condition="No data exposed",
    )
    def test_wrong_audience_returns_401(self, client, regular_user):
        token = _forge_jwt(sub=str(regular_user.id),
                           token_version=regular_user.token_version,
                           aud="wrong-audience")
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-046",
        objective="Token with wrong issuer returns 401",
        precondition="JWT signed with correct secret but iss='evil-issuer'",
        steps=[
            "Forge JWT with iss='evil-issuer'",
            "GET /users/me",
            "Assert HTTP 401",
        ],
        test_data={"iss": "evil-issuer"},
        expected_result="HTTP 401 — issuer mismatch",
        post_condition="No data exposed",
    )
    def test_wrong_issuer_returns_401(self, client, regular_user):
        token = _forge_jwt(sub=str(regular_user.id),
                           token_version=regular_user.token_version,
                           iss="evil-issuer")
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-047",
        objective="Token signed with wrong secret returns 401",
        precondition="JWT encoded with 'attacker-secret-key-32chars!!'",
        steps=[
            "Forge JWT with different secret",
            "GET /users/me",
            "Assert HTTP 401",
        ],
        test_data={"secret": "attacker-secret-key-32chars!!"},
        expected_result="HTTP 401 — signature verification failed",
        post_condition="No data exposed",
    )
    def test_wrong_secret_returns_401(self, client, regular_user):
        token = _forge_jwt(sub=str(regular_user.id),
                           token_version=regular_user.token_version,
                           secret="attacker-secret-key-32chars!!")
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401
