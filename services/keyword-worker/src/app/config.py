import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    service_name: str
    host: str
    port: int
    rabbitmq_host: str
    rabbitmq_port: int
    rabbitmq_user: str
    rabbitmq_pass: str
    rabbitmq_vhost: str
    mongo_url: str
    mongo_db: str
    prefetch: int
    max_keywords: int


def load_settings() -> Settings:
    prefetch_raw = os.getenv("PREFETCH", "10")
    prefetch = int(prefetch_raw) if prefetch_raw.isdigit() and int(prefetch_raw) > 0 else 10
    max_kw_raw = os.getenv("MAX_KEYWORDS", "5")
    max_keywords = int(max_kw_raw) if max_kw_raw.isdigit() and int(max_kw_raw) > 0 else 5

    return Settings(
        service_name=os.getenv("SERVICE_NAME", "keyword-worker"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8080")),
        rabbitmq_host=os.getenv("RABBITMQ_HOST", "rabbitmq"),
        rabbitmq_port=int(os.getenv("RABBITMQ_PORT", "5672")),
        rabbitmq_user=os.getenv("RABBITMQ_USER", "guest"),
        rabbitmq_pass=os.getenv("RABBITMQ_PASS", "guest"),
        rabbitmq_vhost=os.getenv("RABBITMQ_VHOST", "rasa"),
        mongo_url=os.getenv("MONGO_URL", "mongodb://mongodb:27017"),
        mongo_db=os.getenv("MONGO_DB", "keyword-db"),
        prefetch=prefetch,
        max_keywords=max_keywords,
    )
