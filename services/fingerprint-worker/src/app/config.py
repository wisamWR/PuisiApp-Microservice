
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    service_name: str
    host: str
    port: int
    amqp_url: str
    hash_seed: int
    num_hashes: int
    shingle_size: int


def load_settings() -> Settings:
    return Settings(
        service_name=os.getenv("SERVICE_NAME", "fingerprint-worker"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8080")),
        amqp_url=os.getenv("AMQP_URL", ""),
        hash_seed=int(os.getenv("MINHASH_SEED", "42")),
        num_hashes=int(os.getenv("MINHASH_NUM_HASHES", "128")),
        shingle_size=int(os.getenv("SHINGLE_SIZE", "3")),
    )
