from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # DB aziendale di default (prima azienda / singolo tenant legacy)
    DATABASE_URL: str = "mysql+asyncmy://posmanager:posmanager@mysql:3306/posmanager"
    # DB principale (companies + users)
    MAIN_DB_URL: str = ""
    # URL root MySQL per creare posmanager_main al primo avvio (opzionale)
    DATABASE_ROOT_URL: str = ""

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

    # Superadmin globale (company_id=None) — creato/aggiornato ad ogni avvio se configurato
    SUPERADMIN_USERNAME: str = ""
    SUPERADMIN_PASSWORD: str = ""

    # Discogs (legacy: sarà migrato in company_settings_integrations al primo avvio)
    DISCOGS_TOKEN: str = ""
    INVENTORY_CSV_DIR: str = "/inventory"

    DISCOGS_USERNAME: str = ""
    DISCOGS_PASSWORD: str = ""
    DISCOGS_STATE_PATH: str = "/inventory/discogs_state.json"

    @property
    def main_db_url(self) -> str:
        """URL del DB principale. Se non impostato, deriva da DATABASE_URL cambiando il nome DB."""
        if self.MAIN_DB_URL:
            return self.MAIN_DB_URL
        base, _ = self.DATABASE_URL.rsplit("/", 1)
        return f"{base}/posmanager_main"

    @property
    def default_company_db(self) -> str:
        """Nome del DB della prima azienda (estratto da DATABASE_URL)."""
        return self.DATABASE_URL.rsplit("/", 1)[-1]


settings = Settings()
