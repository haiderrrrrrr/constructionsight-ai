from cryptography.fernet import Fernet
from .config import settings


def encrypt_credential(plaintext: str) -> str:
    f = Fernet(settings.camera_encryption_key.encode())
    return f.encrypt(plaintext.encode()).decode()


def decrypt_credential(ciphertext: str) -> str:
    f = Fernet(settings.camera_encryption_key.encode())
    return f.decrypt(ciphertext.encode()).decode()
