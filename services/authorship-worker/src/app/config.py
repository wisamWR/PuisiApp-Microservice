import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    service_name: str
    host: str
    port: int
    amqp_url: str
    database_url: str


def load_settings() -> Settings:
    return Settings(
        service_name=os.getenv("SERVICE_NAME", "authorship-worker"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8080")),
        amqp_url=os.getenv("AMQP_URL", ""),
        database_url=os.getenv("DATABASE_URL", ""),
    )
