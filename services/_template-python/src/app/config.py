import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    service_name: str
    host: str
    port: int
    database_url: str | None
    amqp_url: str | None
    redis_url: str | None
    s3_endpoint: str | None
    smtp_host: str | None
    service_urls: dict[str, str] = field(default_factory=dict)


def load_settings() -> Settings:
    service_urls = {
        key.removesuffix("_SERVICE_URL").lower(): value
        for key, value in os.environ.items()
        if key.endswith("_SERVICE_URL") and value
    }

    return Settings(
        service_name=os.getenv("SERVICE_NAME", "python-service"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8080")),
        database_url=os.getenv("DATABASE_URL"),
        amqp_url=os.getenv("AMQP_URL"),
        redis_url=os.getenv("REDIS_URL"),
        s3_endpoint=os.getenv("S3_ENDPOINT"),
        smtp_host=os.getenv("SMTP_HOST"),
        service_urls=service_urls,
    )