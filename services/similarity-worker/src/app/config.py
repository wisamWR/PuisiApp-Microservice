import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    service_name: str
    host: str
    port: int
    database_url: str
    amqp_url: str
    minhash_num_hashes: int
    lsh_bands: int
    lsh_rows: int
    threshold_inspired: float
    threshold_similar: float
    threshold_plagiarism: float


def load_settings() -> Settings:
    bands = int(os.getenv("LSH_BANDS", "32"))
    rows = int(os.getenv("LSH_ROWS", "4"))

    if bands * rows != 128:
        raise ValueError("LSH_BANDS x LSH_ROWS harus sama dengan 128")

    return Settings(
        service_name=os.getenv("SERVICE_NAME", "similarity-worker"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8080")),
        database_url=os.getenv("DATABASE_URL", ""),
        amqp_url=os.getenv("AMQP_URL", ""),
        minhash_num_hashes=int(os.getenv("MINHASH_NUM_HASHES", "128")),
        lsh_bands=bands,
        lsh_rows=rows,
        threshold_inspired=float(os.getenv("THRESHOLD_INSPIRED", "0.20")),
        threshold_similar=float(os.getenv("THRESHOLD_SIMILAR", "0.50")),
        threshold_plagiarism=float(os.getenv("THRESHOLD_PLAGIARISM", "0.80")),
    )
