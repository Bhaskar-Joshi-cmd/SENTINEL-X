from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


SERVER_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    sensor_ingest_key: str = ""
    replay_step_delay_seconds: float = 2.0
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=SERVER_DIR / ".env",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            x.strip()
            for x in self.cors_origins.split(",")
            if x.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()