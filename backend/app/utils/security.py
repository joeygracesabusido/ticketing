"""Security helpers - placeholder for Task 4 (JWT/bcrypt).
Provides minimal stubs so imports succeed for models/migrations."""
from passlib.context import CryptContext
import jwt
import datetime
from app.config.settings import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.datetime.utcnow() + datetime.timedelta(
        minutes=settings.jwt_access_exp_minutes
    )
    return jwt.encode(to_encode, settings.jwt_secret, algorithm="HS256")


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.datetime.utcnow() + datetime.timedelta(
        days=settings.jwt_refresh_exp_days
    )
    return jwt.encode(to_encode, settings.jwt_refresh_secret, algorithm="HS256")


def decode_token(token: str, refresh: bool = False) -> dict:
    secret = settings.jwt_refresh_secret if refresh else settings.jwt_secret
    return jwt.decode(token, secret, algorithms=["HS256"])
