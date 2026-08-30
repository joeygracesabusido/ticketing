from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://ferry:ferry@localhost:5432/ferry"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "dev-access-secret-change-me-32chars!!"
    jwt_refresh_secret: str = "dev-refresh-secret-change-me-32chars!!"
    jwt_access_exp_minutes: int = 15
    jwt_refresh_exp_days: int = 7
    cors_origins: str = "http://localhost:5173"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
