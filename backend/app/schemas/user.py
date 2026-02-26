from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from ..models.user import PlatformRole
import re

# Top 50 most commonly used passwords — rejected even if they meet complexity rules
_COMMON_PASSWORDS = {
    "Password1!", "Password1@", "Password123!", "Admin1234!", "Welcome1!",
    "Qwerty123!", "Letmein1!", "Monkey123!", "Dragon123!", "Master123!",
    "Summer2024!", "Winter2024!", "Spring2024!", "Autumn2024!", "Login123!",
    "Pass1234!", "Test1234!", "User1234!", "Root1234!", "Admin123!",
    "Hello123!", "Start123!", "Change1!", "Secret1!", "Access1!",
    "Shadow1!", "Batman1!", "Trustno1!", "Baseball1!", "Football1!",
    "Superman1!", "Michael1!", "Jennifer1!", "Jordan123!", "Ranger1!",
    "Pepper123!", "Soccer123!", "Hockey123!", "Harley123!", "Ranger123!",
    "Charlie1!", "Donald1!", "Andrew1!", "Thomas1!", "George1!",
    "Jordan1!", "Hunter1!", "Buster1!", "Tigger1!", "Robert1!",
}


class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    username: str
    password: str
    invite_token: Optional[str] = None

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2 or len(v) > 100:
            raise ValueError("Full name must be 2-100 characters long")
        # Letters, spaces, apostrophes, hyphens, dots — no digits or underscores
        if not re.match(r"^[A-Za-z][A-Za-z\s'\-.]{1,99}$", v):
            raise ValueError("Full name must contain only letters, spaces, apostrophes, hyphens, or dots")
        return v

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        v = v.strip().lower()
        if len(v) < 3 or len(v) > 30:
            raise ValueError("Username must be 3-30 characters long")
        if not re.match(r"^[a-z][a-z0-9_.-]{2,29}$", v):
            raise ValueError("Username must start with a letter and include only letters, digits, _ . -")
        return v

    @field_validator("password")
    @classmethod
    def strong_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if len(v) > 128:
            raise ValueError("Password must not exceed 128 characters")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must include an uppercase letter")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must include a lowercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must include a number")
        if not re.search(r"[^A-Za-z0-9]", v):
            raise ValueError("Password must include a special character")
        if v in _COMMON_PASSWORDS:
            raise ValueError("Password is too common. Please choose a stronger password")
        return v


class UserLogin(BaseModel):
    identifier: str = Field(..., min_length=1, max_length=254)  # email max is 254 chars
    password: str = Field(..., min_length=1, max_length=128)
    remember: Optional[bool] = False


class UserOut(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    username: str
    platform_role: PlatformRole
    is_active: bool

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    platform_role: PlatformRole


class UserMeOut(BaseModel):
    """User profile response for /users/me endpoint"""
    id: int
    full_name: str
    email: EmailStr
    username: str
    platform_role: PlatformRole
    is_active: bool
    avatar_url: Optional[str] = None
    created_at: str  # ISO format datetime
    auth_provider: str
    theme_skin: str = "dark"  # Default to dark

    class Config:
        from_attributes = True


class UserProfileUpdate(BaseModel):
    """Update user's full name and/or username"""
    full_name: Optional[str] = None
    username: Optional[str] = None
    current_password: Optional[str] = None

    @field_validator("full_name")
    @classmethod
    def validate_full_name_if_provided(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) < 2 or len(v) > 100:
            raise ValueError("Full name must be 2-100 characters long")
        if not re.match(r"^[A-Za-z][A-Za-z\s'\-.]{1,99}$", v):
            raise ValueError("Full name must contain only letters, spaces, apostrophes, hyphens, or dots")
        return v

    @field_validator("username")
    @classmethod
    def validate_username_if_provided(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().lower()
        if len(v) < 3 or len(v) > 30:
            raise ValueError("Username must be 3-30 characters long")
        if not re.match(r"^[a-z][a-z0-9_.-]{2,29}$", v):
            raise ValueError("Username must start with a letter and include only letters, digits, _ . -")
        return v


class UserPasswordChange(BaseModel):
    """Change user's password"""
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def strong_password_for_change(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if len(v) > 128:
            raise ValueError("Password must not exceed 128 characters")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must include an uppercase letter")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must include a lowercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must include a number")
        if not re.search(r"[^A-Za-z0-9]", v):
            raise ValueError("Password must include a special character")
        if v in _COMMON_PASSWORDS:
            raise ValueError("Password is too common. Please choose a stronger password")
        return v


class AdminUserOut(BaseModel):
    """Admin view of a user with all details including project count"""
    id: int
    full_name: str
    email: EmailStr
    username: str
    platform_role: PlatformRole
    is_active: bool
    is_approved: bool
    auth_provider: str
    avatar_url: Optional[str] = None
    created_at: str  # ISO format datetime
    failed_login_count: int
    locked_until: Optional[str] = None  # ISO format datetime
    active_project_count: int

    class Config:
        from_attributes = True


class UserThemeUpdate(BaseModel):
    """Update user's theme preference"""
    theme_skin: Optional[str] = None

    @field_validator("theme_skin", mode="before")
    @classmethod
    def validate_theme_value(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("dark", "light"):
            raise ValueError("Theme value must be 'dark' or 'light'")
        return v


class UserRoleUpdate(BaseModel):
    """Update user's platform role"""
    role: str  # "admin" or "user"
