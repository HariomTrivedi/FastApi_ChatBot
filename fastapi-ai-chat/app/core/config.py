from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_env: str = Field(default="development", alias="APP_ENV")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    groq_api_key: str | None = Field(default=None, alias="GROQ_API_KEY")
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-1.5-flash", alias="GEMINI_MODEL")
    allow_origins: List[str] = Field(default_factory=lambda: ["*"], alias="ALLOW_ORIGINS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    uploads_dir: str = Field(default="uploads", alias="UPLOADS_DIR")
    vector_db_dir: str = Field(default="data/chroma", alias="VECTOR_DB_DIR")
    chroma_mode: str = Field(default="local", alias="CHROMA_MODE")  # local | cloud
    chroma_api_key: str | None = Field(default=None, alias="CHROMA_API_KEY")
    chroma_tenant: str | None = Field(default=None, alias="CHROMA_TENANT")
    chroma_database: str | None = Field(default=None, alias="CHROMA_DATABASE")
    database_url: str = Field(default="sqlite:///./chatbot.db", alias="DATABASE_URL")
    secret_key: str = Field(default="your-secret-key-change-in-production", alias="SECRET_KEY")
    algorithm: str = Field(default="HS256", alias="ALGORITHM")
    access_token_expire_minutes: int = Field(default=1440, alias="ACCESS_TOKEN_EXPIRE_MINUTES")  # 24 hours

    model_config = {"case_sensitive": False, "env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()