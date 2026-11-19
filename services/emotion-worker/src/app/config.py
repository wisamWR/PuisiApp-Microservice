import os
from dataclasses import dataclass
from pathlib import Path


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
    lexicon_path: Path
    model_mode: str
    indobert_model_dir: Path
    prefetch: int


def load_settings() -> Settings:
    default_lexicon = Path(__file__).resolve().parents[2] / "data" / "kamus_emosi.json"
    prefetch_raw = os.getenv("PREFETCH", "10")
    prefetch = int(prefetch_raw) if prefetch_raw.isdigit() and int(prefetch_raw) > 0 else 10
    mode_raw = os.getenv("MODEL", "lexicon").strip().lower()
    model_mode = mode_raw if mode_raw in ("lexicon", "indobert") else "lexicon"

    return Settings(
        service_name=os.getenv("SERVICE_NAME", "emotion-worker"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8080")),
        rabbitmq_host=os.getenv("RABBITMQ_HOST", "rabbitmq"),
        rabbitmq_port=int(os.getenv("RABBITMQ_PORT", "5672")),
        rabbitmq_user=os.getenv("RABBITMQ_USER", "guest"),
        rabbitmq_pass=os.getenv("RABBITMQ_PASS", "guest"),
        rabbitmq_vhost=os.getenv("RABBITMQ_VHOST", "rasa"),
        mongo_url=os.getenv("MONGO_URL", "mongodb://mongodb:27017"),
        mongo_db=os.getenv("MONGO_DB", "emotion-db"),
        lexicon_path=Path(os.getenv("LEXICON_PATH", str(default_lexicon))),
        model_mode=model_mode,
        indobert_model_dir=Path(os.getenv("INDOBERT_MODEL_DIR", "/models/indobert-emot")),
        prefetch=prefetch,
    )
