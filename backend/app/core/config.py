from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "mysql+asyncmy://connectly:connectly@localhost:3306/connectly?charset=utf8mb4"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "change-me-in-production-change-me-please-0000"
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    upload_dir: str = "./uploads"
    max_upload_mb: int = 10
    # Convenient for development. In production, prefer `alembic upgrade head`.
    auto_create_tables: bool = True
    rate_limit_messages_per_10s: int = 20

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
