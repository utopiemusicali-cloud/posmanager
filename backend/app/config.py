from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "mysql+asyncmy://posmanager:posmanager@mysql:3306/posmanager"
    SECRET_KEY: str = "change-me-in-production-please"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # CORS: stringa CSV, es. "https://example.com,http://localhost:5173"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    FIRST_ADMIN_USERNAME: str = "admin"
    FIRST_ADMIN_PASSWORD: str = "changeme"

    # Discogs
    DISCOGS_TOKEN: str = ""
    INVENTORY_CSV_DIR: str = "/inventory"

    # Discogs login per scraping vendite/mercato (Playwright)
    DISCOGS_USERNAME: str = ""
    DISCOGS_PASSWORD: str = ""
    DISCOGS_STATE_PATH: str = "/inventory/discogs_state.json"


settings = Settings()
