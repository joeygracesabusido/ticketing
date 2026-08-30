from passlib.context import CryptContext
import jwt, datetime
from app.config.settings import get_settings
settings = get_settings()
pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")

def hash_password(p: str) -> str: return pwd_context.hash(p)
def verify_password(p: str, h: str) -> bool: return pwd_context.verify(p, h)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.datetime.utcnow() + datetime.timedelta(minutes=settings.jwt_access_exp_minutes)
    return jwt.encode(to_encode, settings.jwt_secret, algorithm="HS256")

def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.datetime.utcnow() + datetime.timedelta(days=settings.jwt_refresh_exp_days)
    return jwt.encode(to_encode, settings.jwt_refresh_secret, algorithm="HS256")

def decode_token(token: str, refresh=False) -> dict:
    secret = settings.jwt_refresh_secret if refresh else settings.jwt_secret
    return jwt.decode(token, secret, algorithms=["HS256"])
