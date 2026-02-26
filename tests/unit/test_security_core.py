"""
Unit tests for app/core/security.py

Tests all functions in isolation — no DB, no HTTP, no fixtures beyond
what Python provides. These run in milliseconds and catch logic regressions
in the security layer before they reach integration tests.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Unit Tests"),
    allure.story("Security Core"),
    pytest.mark.unit,
]

import time
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError

from app.core.security import (
    create_access_token,
    decode_access_token,
    verify_password,
    get_password_hash,
    generate_refresh_token,
    hash_token,
)
from app.core.config import settings


class TestPasswordHashing:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-001",
        objective="Hashed password is not the same as plaintext",
        precondition="None — pure Python function call",
        steps=["Call get_password_hash('MySecret99!')", "Assert hash != plaintext"],
        test_data={"password": "MySecret99!"},
        expected_result="Hash differs from plaintext",
        post_condition="No side effects",
    )
    def test_hash_is_not_plaintext(self):
        h = get_password_hash("MySecret99!")
        assert h != "MySecret99!"

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-002",
        objective="Correct password verifies successfully against its hash",
        precondition="None",
        steps=["Hash 'CorrectHorse99!'", "verify_password('CorrectHorse99!', hash)", "Assert True"],
        test_data={"password": "CorrectHorse99!"},
        expected_result="verify_password returns True",
        post_condition="No side effects",
    )
    def test_correct_password_verifies(self):
        h = get_password_hash("CorrectHorse99!")
        assert verify_password("CorrectHorse99!", h) is True

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-003",
        objective="Wrong password fails verification",
        precondition="None",
        steps=["Hash 'CorrectHorse99!'", "verify_password('WrongPassword!', hash)", "Assert False"],
        test_data={"password": "WrongPassword!"},
        expected_result="verify_password returns False",
        post_condition="No side effects",
    )
    def test_wrong_password_fails(self):
        h = get_password_hash("CorrectHorse99!")
        assert verify_password("WrongPassword!", h) is False

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-004",
        objective="Empty string does not verify against a real hash",
        precondition="None",
        steps=["Hash 'SomePassword1!'", "verify_password('', hash)", "Assert False"],
        test_data={"password": "'' (empty)"},
        expected_result="verify_password returns False",
        post_condition="No side effects",
    )
    def test_empty_password_does_not_verify_against_real_hash(self):
        h = get_password_hash("SomePassword1!")
        assert verify_password("", h) is False

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-005",
        objective="Two hashes of the same password are different (Argon2 random salt)",
        precondition="None",
        steps=["Hash 'SamePassword1!' twice", "Assert h1 != h2"],
        test_data={"password": "SamePassword1!"},
        expected_result="h1 != h2 (random salt per call)",
        post_condition="No side effects",
    )
    def test_two_hashes_of_same_password_are_different(self):
        h1 = get_password_hash("SamePassword1!")
        h2 = get_password_hash("SamePassword1!")
        assert h1 != h2

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-006",
        objective="Argon2 hash output starts with the $argon2 identifier",
        precondition="None",
        steps=["get_password_hash('TestPass123!')", "Assert starts with '$argon2'"],
        test_data={"password": "TestPass123!"},
        expected_result="Hash starts with '$argon2'",
        post_condition="No side effects",
    )
    def test_hash_starts_with_argon2_identifier(self):
        h = get_password_hash("TestPass123!")
        assert h.startswith("$argon2")


class TestCreateAccessToken:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-007",
        objective="create_access_token returns a non-empty string",
        precondition="None",
        steps=["create_access_token('42', 'user', token_version=1)", "Assert isinstance(str) and len > 20"],
        test_data={"sub": "42", "role": "user", "token_version": 1},
        expected_result="Non-empty string token",
        post_condition="No side effects",
    )
    def test_returns_string(self):
        token = create_access_token("42", "user", token_version=1)
        assert isinstance(token, str)
        assert len(token) > 20

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-008",
        objective="JWT token has the standard three-part dot-separated structure",
        precondition="None",
        steps=["create_access_token", "Assert token.count('.') == 2"],
        test_data={"sub": "42"},
        expected_result="header.payload.signature format",
        post_condition="No side effects",
    )
    def test_token_contains_three_dot_separated_parts(self):
        token = create_access_token("42", "user")
        assert token.count(".") == 2

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-009",
        objective="Token sub claim matches the user_id argument",
        precondition="None",
        steps=["create_access_token('99', 'user')", "decode_access_token", "Assert sub == '99'"],
        test_data={"sub": "99"},
        expected_result="payload['sub'] == '99'",
        post_condition="No side effects",
    )
    def test_sub_claim_is_set(self):
        token = create_access_token("99", "user")
        payload = decode_access_token(token)
        assert payload["sub"] == "99"

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-010",
        objective="Token platform_role claim matches the role argument",
        precondition="None",
        steps=["create_access_token('1', 'admin')", "Assert platform_role == 'admin'"],
        test_data={"role": "admin"},
        expected_result="payload['platform_role'] == 'admin'",
        post_condition="No side effects",
    )
    def test_platform_role_claim_is_set(self):
        token = create_access_token("1", "admin")
        payload = decode_access_token(token)
        assert payload["platform_role"] == "admin"

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-011",
        objective="Token ver claim matches the token_version argument",
        precondition="None",
        steps=["create_access_token('1', 'user', token_version=7)", "Assert ver == 7"],
        test_data={"token_version": 7},
        expected_result="payload['ver'] == 7",
        post_condition="No side effects",
    )
    def test_ver_claim_matches_token_version(self):
        token = create_access_token("1", "user", token_version=7)
        payload = decode_access_token(token)
        assert payload["ver"] == 7

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-012",
        objective="Token iss claim matches settings.jwt_issuer",
        precondition="None",
        steps=["create_access_token", "Assert iss == settings.jwt_issuer"],
        test_data={"expected_iss": "settings.jwt_issuer"},
        expected_result="payload['iss'] == settings.jwt_issuer",
        post_condition="No side effects",
    )
    def test_iss_claim_matches_settings(self):
        token = create_access_token("1", "user")
        payload = decode_access_token(token)
        assert payload["iss"] == settings.jwt_issuer

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-013",
        objective="Token aud claim matches settings.jwt_audience",
        precondition="None",
        steps=["create_access_token", "Assert aud == settings.jwt_audience"],
        test_data={"expected_aud": "settings.jwt_audience"},
        expected_result="payload['aud'] == settings.jwt_audience",
        post_condition="No side effects",
    )
    def test_aud_claim_matches_settings(self):
        token = create_access_token("1", "user")
        payload = decode_access_token(token)
        assert payload["aud"] == settings.jwt_audience

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-014",
        objective="Token exp claim is set to a future Unix timestamp",
        precondition="None",
        steps=["create_access_token with expires_minutes=30", "Assert exp > now"],
        test_data={"expires_minutes": 30},
        expected_result="payload['exp'] > current timestamp",
        post_condition="No side effects",
    )
    def test_exp_claim_is_in_future(self):
        token = create_access_token("1", "user", expires_minutes=30)
        payload = decode_access_token(token)
        assert payload["exp"] > int(datetime.now(timezone.utc).timestamp())

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-015",
        objective="Two tokens for the same user have unique jti claims",
        precondition="None",
        steps=["create_access_token twice for same user", "Assert jti1 != jti2"],
        test_data={"sub": "1"},
        expected_result="jti values differ between the two tokens",
        post_condition="No side effects",
    )
    def test_jti_claim_is_unique_per_token(self):
        t1 = create_access_token("1", "user")
        t2 = create_access_token("1", "user")
        p1 = decode_access_token(t1)
        p2 = decode_access_token(t2)
        assert p1["jti"] != p2["jti"]

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-016",
        objective="Token iat claim is set to a recent timestamp",
        precondition="None",
        steps=["Record 'before' timestamp", "create_access_token", "Assert iat >= before"],
        test_data={"tolerance_seconds": 2},
        expected_result="payload['iat'] >= before",
        post_condition="No side effects",
    )
    def test_iat_claim_is_recent(self):
        before = int(datetime.now(timezone.utc).timestamp()) - 2
        token = create_access_token("1", "user")
        payload = decode_access_token(token)
        assert payload["iat"] >= before


class TestDecodeAccessToken:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-017",
        objective="Decoding a valid token returns a dictionary",
        precondition="Valid token issued by create_access_token",
        steps=["create_access_token('5', 'user')", "decode_access_token", "Assert isinstance(dict)"],
        test_data={"sub": "5"},
        expected_result="Returns dict",
        post_condition="No side effects",
    )
    def test_valid_token_returns_dict(self):
        token = create_access_token("5", "user")
        result = decode_access_token(token)
        assert isinstance(result, dict)

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-018",
        objective="All 8 required JWT claims are present in the decoded payload",
        precondition="Valid token with token_version=3",
        steps=["create_access_token('5', 'user', token_version=3)", "Assert all 8 claims present"],
        test_data={"claims": "sub, platform_role, exp, iat, iss, aud, jti, ver"},
        expected_result="All 8 claims in payload dict",
        post_condition="No side effects",
    )
    def test_all_required_claims_present(self):
        token = create_access_token("5", "user", token_version=3)
        p = decode_access_token(token)
        for claim in ("sub", "platform_role", "exp", "iat", "iss", "aud", "jti", "ver"):
            assert claim in p, f"Missing claim: {claim}"


class TestDecodeAccessTokenRejection:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-019",
        objective="Expired token raises JWTError",
        precondition="Token with expires_minutes=-1 (already expired)",
        steps=["create_access_token with expires_minutes=-1", "decode_access_token", "Assert raises JWTError"],
        test_data={"expires_minutes": -1},
        expected_result="JWTError raised",
        post_condition="No side effects",
    )
    def test_expired_token_raises(self):
        token = create_access_token("1", "user", expires_minutes=-1)
        with pytest.raises(JWTError):
            decode_access_token(token)

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-020",
        objective="Token signed with wrong secret raises JWTError",
        precondition="Token encoded with 'completely-different-secret-key-32chars!!'",
        steps=["Manually encode JWT with wrong secret", "decode_access_token", "Assert raises JWTError"],
        test_data={"secret": "completely-different-secret-key-32chars!!"},
        expected_result="JWTError raised — signature mismatch",
        post_condition="No side effects",
    )
    def test_wrong_secret_raises(self):
        payload = {
            "sub": "1", "platform_role": "user",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
            "iat": int(datetime.now(timezone.utc).timestamp()),
            "iss": settings.jwt_issuer, "aud": settings.jwt_audience,
            "jti": "test-jti", "ver": 1,
        }
        evil_token = jwt.encode(payload, "completely-different-secret-key-32chars!!", algorithm="HS256")
        with pytest.raises(JWTError):
            decode_access_token(evil_token)

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-021",
        objective="Tampered payload bytes cause signature verification failure",
        precondition="Valid token — payload section modified",
        steps=[
            "Create valid token",
            "Flip last char of base64 payload section",
            "decode_access_token with tampered token",
            "Assert raises Exception",
        ],
        test_data={"tampering": "flip last base64 char of payload"},
        expected_result="Exception raised — signature invalid",
        post_condition="No side effects",
    )
    def test_tampered_payload_raises(self):
        token = create_access_token("1", "user")
        header, payload_b64, sig = token.split(".")
        tampered = payload_b64[:-1] + ("A" if payload_b64[-1] != "A" else "B")
        tampered_token = f"{header}.{tampered}.{sig}"
        with pytest.raises(Exception):
            decode_access_token(tampered_token)

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-022",
        objective="Token with wrong audience raises JWTError",
        precondition="Token signed with correct secret but aud='wrong-audience'",
        steps=["Encode JWT with aud='wrong-audience'", "decode_access_token", "Assert raises JWTError"],
        test_data={"aud": "wrong-audience"},
        expected_result="JWTError raised — audience mismatch",
        post_condition="No side effects",
    )
    def test_wrong_audience_raises(self):
        payload = {
            "sub": "1", "platform_role": "user",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
            "iat": int(datetime.now(timezone.utc).timestamp()),
            "iss": settings.jwt_issuer, "aud": "wrong-audience",
            "jti": "test-jti", "ver": 1,
        }
        bad_aud_token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
        with pytest.raises(JWTError):
            decode_access_token(bad_aud_token)

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-023",
        objective="Token with wrong issuer raises JWTError",
        precondition="Token signed with correct secret but iss='evil-issuer'",
        steps=["Encode JWT with iss='evil-issuer'", "decode_access_token", "Assert raises JWTError"],
        test_data={"iss": "evil-issuer"},
        expected_result="JWTError raised — issuer mismatch",
        post_condition="No side effects",
    )
    def test_wrong_issuer_raises(self):
        payload = {
            "sub": "1", "platform_role": "user",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
            "iat": int(datetime.now(timezone.utc).timestamp()),
            "iss": "evil-issuer", "aud": settings.jwt_audience,
            "jti": "test-jti", "ver": 1,
        }
        bad_iss_token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
        with pytest.raises(JWTError):
            decode_access_token(bad_iss_token)

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-024",
        objective="alg:none attack token is rejected",
        precondition="Manually crafted JWT with alg=none header",
        steps=[
            "Build header with alg='none', encode payload without signature",
            "decode_access_token",
            "Assert raises Exception",
        ],
        test_data={"alg": "none"},
        expected_result="Exception raised — algorithm 'none' not accepted",
        post_condition="No side effects",
    )
    def test_none_algorithm_token_raises(self):
        import base64, json
        header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
        payload_data = {
            "sub": "1", "platform_role": "admin",
            "exp": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()),
            "iat": int(datetime.now(timezone.utc).timestamp()),
            "iss": settings.jwt_issuer, "aud": settings.jwt_audience,
            "jti": "alg-none-attack", "ver": 1,
        }
        body = base64.urlsafe_b64encode(json.dumps(payload_data).encode()).rstrip(b"=").decode()
        none_token = f"{header}.{body}."
        with pytest.raises(Exception):
            decode_access_token(none_token)

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-025",
        objective="Completely malformed string raises Exception on decode",
        precondition="Input: 'not.a.jwt'",
        steps=["decode_access_token('not.a.jwt')", "Assert raises Exception"],
        test_data={"token": "not.a.jwt"},
        expected_result="Exception raised",
        post_condition="No side effects",
    )
    def test_completely_garbage_string_raises(self):
        with pytest.raises(Exception):
            decode_access_token("not.a.jwt")

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-026",
        objective="Empty string raises Exception on decode",
        precondition="Input: ''",
        steps=["decode_access_token('')", "Assert raises Exception"],
        test_data={"token": "'' (empty)"},
        expected_result="Exception raised",
        post_condition="No side effects",
    )
    def test_empty_string_raises(self):
        with pytest.raises(Exception):
            decode_access_token("")


class TestRefreshTokenHelpers:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-027",
        objective="generate_refresh_token returns a string",
        precondition="None",
        steps=["generate_refresh_token()", "Assert isinstance(str)"],
        test_data={},
        expected_result="String token returned",
        post_condition="No side effects",
    )
    def test_generate_refresh_token_returns_string(self):
        t = generate_refresh_token()
        assert isinstance(t, str)

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-028",
        objective="Refresh token contains only URL-safe characters",
        precondition="None",
        steps=["generate_refresh_token()", "Check for unsafe chars"],
        test_data={"allowed_chars": "A-Z a-z 0-9 - _ ="},
        expected_result="No URL-unsafe characters in token",
        post_condition="No side effects",
    )
    def test_generate_refresh_token_is_url_safe(self):
        t = generate_refresh_token()
        unsafe = set(t) - set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=")
        assert not unsafe, f"Unsafe characters found: {unsafe}"

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-029",
        objective="Refresh token is at least 64 characters (sufficient entropy)",
        precondition="None",
        steps=["generate_refresh_token()", "Assert len >= 64"],
        test_data={"min_length": 64},
        expected_result="Token length >= 64",
        post_condition="No side effects",
    )
    def test_generate_refresh_token_is_long_enough(self):
        t = generate_refresh_token()
        assert len(t) >= 64

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-030",
        objective="Two consecutive refresh tokens are unique (entropy check)",
        precondition="None",
        steps=["generate_refresh_token() x2", "Assert t1 != t2"],
        test_data={},
        expected_result="Two tokens differ",
        post_condition="No side effects",
    )
    def test_two_refresh_tokens_are_unique(self):
        assert generate_refresh_token() != generate_refresh_token()

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-031",
        objective="hash_token returns a hex string (only 0-9 a-f characters)",
        precondition="None",
        steps=["hash_token('some-random-token')", "Assert all chars in hex set"],
        test_data={"input": "some-random-token"},
        expected_result="All characters are valid hex digits",
        post_condition="No side effects",
    )
    def test_hash_token_returns_hex_string(self):
        h = hash_token("some-random-token")
        assert all(c in "0123456789abcdef" for c in h)

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-032",
        objective="hash_token is deterministic — same input always produces same output",
        precondition="None",
        steps=["hash_token('abc') twice", "Assert outputs equal"],
        test_data={"input": "abc"},
        expected_result="hash_token('abc') == hash_token('abc')",
        post_condition="No side effects",
    )
    def test_hash_token_is_deterministic(self):
        assert hash_token("abc") == hash_token("abc")

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-033",
        objective="Different token inputs produce different hashes",
        precondition="None",
        steps=["hash_token('token-a')", "hash_token('token-b')", "Assert outputs differ"],
        test_data={"inputs": "token-a, token-b"},
        expected_result="hash_token('token-a') != hash_token('token-b')",
        post_condition="No side effects",
    )
    def test_different_tokens_produce_different_hashes(self):
        assert hash_token("token-a") != hash_token("token-b")

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SEC-034",
        objective="SHA-256 hex digest is always 64 characters",
        precondition="None",
        steps=["hash_token('anything')", "Assert len == 64"],
        test_data={"input": "anything"},
        expected_result="Hash length == 64",
        post_condition="No side effects",
    )
    def test_hash_token_length_is_sha256(self):
        assert len(hash_token("anything")) == 64
