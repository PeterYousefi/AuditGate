import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
import certifi


class Settings(BaseSettings):
    MONGODB_URI: str
    GEMINI_API_KEY: str
    ELEVENLABS_API_KEY: str
    ELEVENLABS_VOICE_ID: str = "21m00Tcm4TlvDq8ikWAM"  # Rachel voice
    ELEVENLABS_MODEL_ID: str = "eleven_flash_v2_5"
    MONGODB_DB_NAME: str = "auditable_agent"
    GEMINI_MODEL: str = "gemini-3.5-flash"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    TLS_CA_FILE: str = certifi.where()

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
