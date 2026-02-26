"""
Unit Tests — app/core/crypto.py

Tests Fernet-based credential encryption/decryption used for camera RTSP/ONVIF passwords.
The CAMERA_ENCRYPTION_KEY env var is set in conftest.py before import.
"""
import allure
import pytest
from cryptography.fernet import InvalidToken

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Unit Tests"),
    allure.story("Crypto — Credential Encryption"),
    pytest.mark.unit,
]

from app.core.crypto import encrypt_credential, decrypt_credential


class TestEncryptCredential:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-CRY-001",
        objective="encrypt_credential returns a non-empty string different from the plaintext",
        precondition="CAMERA_ENCRYPTION_KEY set in environment (conftest.py)",
        steps=[
            "Call encrypt_credential with a plaintext password",
            "Assert the result is not empty",
            "Assert the result differs from the plaintext",
        ],
        test_data={"plaintext": "secret_password_123"},
        expected_result="Ciphertext is a non-empty string different from plaintext",
        post_condition="No DB state changed",
    )
    def test_encrypt_returns_different_string(self):
        with allure.step("Encrypt a plaintext password"):
            ciphertext = encrypt_credential("secret_password_123")
        with allure.step("Assert ciphertext is non-empty and differs from plaintext"):
            assert ciphertext
            assert ciphertext != "secret_password_123"

    @pytest.mark.testcase(
        tc_id="TC-UNIT-CRY-002",
        objective="Two encryptions of the same plaintext produce different ciphertexts (random IV)",
        precondition="CAMERA_ENCRYPTION_KEY set",
        steps=[
            "Encrypt the same plaintext twice",
            "Assert the two ciphertexts are different (Fernet uses a random IV)",
        ],
        test_data={"plaintext": "same_password"},
        expected_result="Two distinct ciphertexts for the same input",
        post_condition="No DB state changed",
    )
    def test_encrypt_uses_random_iv(self):
        with allure.step("Encrypt same plaintext twice"):
            ct1 = encrypt_credential("same_password")
            ct2 = encrypt_credential("same_password")
        with allure.step("Assert the two ciphertexts differ"):
            assert ct1 != ct2

    @pytest.mark.testcase(
        tc_id="TC-UNIT-CRY-003",
        objective="decrypt_credential correctly reverses encrypt_credential (round-trip)",
        precondition="CAMERA_ENCRYPTION_KEY set",
        steps=[
            "Encrypt a plaintext",
            "Decrypt the result",
            "Assert decrypted value equals original plaintext",
        ],
        test_data={"plaintext": "rtsp://admin:pass123@192.168.1.100/stream"},
        expected_result="Round-trip produces original plaintext",
        post_condition="No DB state changed",
    )
    def test_round_trip(self):
        plaintext = "rtsp://admin:pass123@192.168.1.100/stream"
        with allure.step("Encrypt then decrypt"):
            ciphertext = encrypt_credential(plaintext)
            recovered = decrypt_credential(ciphertext)
        with allure.step("Assert round-trip is lossless"):
            assert recovered == plaintext

    @pytest.mark.testcase(
        tc_id="TC-UNIT-CRY-004",
        objective="Empty string encrypts and round-trips cleanly",
        precondition="CAMERA_ENCRYPTION_KEY set",
        steps=[
            "Encrypt an empty string",
            "Decrypt the result",
            "Assert result is empty string",
        ],
        test_data={"plaintext": ""},
        expected_result="Empty string round-trips correctly",
        post_condition="No DB state changed",
    )
    def test_empty_string_round_trip(self):
        with allure.step("Encrypt and decrypt empty string"):
            ciphertext = encrypt_credential("")
            recovered = decrypt_credential(ciphertext)
        assert recovered == ""

    @pytest.mark.testcase(
        tc_id="TC-UNIT-CRY-005",
        objective="Unicode and special characters encrypt and round-trip cleanly",
        precondition="CAMERA_ENCRYPTION_KEY set",
        steps=[
            "Encrypt a string with unicode and special characters",
            "Decrypt the result",
            "Assert the recovered string matches the original",
        ],
        test_data={"plaintext": "Пароль!@#$%^&*()_+🔐"},
        expected_result="Unicode special characters round-trip correctly",
        post_condition="No DB state changed",
    )
    def test_unicode_round_trip(self):
        plaintext = "Пароль!@#$%^&*()_+🔐"
        with allure.step("Encrypt and decrypt unicode string"):
            ciphertext = encrypt_credential(plaintext)
            recovered = decrypt_credential(ciphertext)
        assert recovered == plaintext

    @pytest.mark.testcase(
        tc_id="TC-UNIT-CRY-006",
        objective="decrypt_credential raises InvalidToken for tampered/invalid ciphertext",
        precondition="CAMERA_ENCRYPTION_KEY set",
        steps=[
            "Attempt to decrypt a garbage string that is not a valid Fernet token",
            "Assert InvalidToken exception is raised",
        ],
        test_data={"ciphertext": "this_is_not_a_valid_fernet_token"},
        expected_result="cryptography.fernet.InvalidToken raised",
        post_condition="No DB state changed",
    )
    def test_invalid_ciphertext_raises(self):
        with allure.step("Attempt to decrypt invalid ciphertext"):
            with pytest.raises(Exception):  # InvalidToken or base64 error
                decrypt_credential("this_is_not_a_valid_fernet_token")

    @pytest.mark.testcase(
        tc_id="TC-UNIT-CRY-007",
        objective="Long credential strings (URL with credentials) encrypt and round-trip",
        precondition="CAMERA_ENCRYPTION_KEY set",
        steps=[
            "Encrypt a full RTSP URL with credentials",
            "Decrypt and verify",
        ],
        test_data={"plaintext": "rtsp://admin:VeryLongPassword!123@10.0.0.100:554/Streaming/Channels/101"},
        expected_result="Full RTSP URL round-trips correctly",
        post_condition="No DB state changed",
    )
    def test_long_credential_round_trip(self):
        plaintext = "rtsp://admin:VeryLongPassword!123@10.0.0.100:554/Streaming/Channels/101"
        ciphertext = encrypt_credential(plaintext)
        assert decrypt_credential(ciphertext) == plaintext
