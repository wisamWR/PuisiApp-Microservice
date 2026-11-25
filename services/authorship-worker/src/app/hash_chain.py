import hashlib
import json
from datetime import datetime, timezone

HASH_NOL = "0" * 64


def sha256(teks: str) -> str:
    return hashlib.sha256(teks.encode("utf-8")).hexdigest()


def hitung_content_hash(body: str) -> str:
    """Menghitung hash dari teks isi puisi."""
    return sha256(body)


def normalisasi_waktu(waktu: str) -> str:
    """Menormalkan timestamp ke UTC ISO-8601."""
    dt = datetime.fromisoformat(waktu.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def hitung_chain_hash(
    index: int,
    poem_id: str,
    version: int,
    content_hash: str,
    recorded_at: str,
    previous_hash: str,
) -> str:
    """Menghitung hash rantai dengan serialisasi JSON kanonis."""
    data = {
        "index": index,
        "poem_id": str(poem_id),
        "version": version,
        "content_hash": content_hash,
        "recorded_at": normalisasi_waktu(recorded_at),
        "previous_hash": previous_hash,
    }

    kanonis = json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return sha256(kanonis)


def buat_catatan(poem_id: str, version: int, body: str,
                 recorded_at: str, previous_hash: str) -> dict:
    """Membentuk satu catatan keaslian."""
    content_hash = hitung_content_hash(body)

    return {
        "poem_id": str(poem_id),
        "version": version,
        "content_hash": content_hash,
        "previous_hash": previous_hash,
        "chain_hash": hitung_chain_hash(
            index=version,
            poem_id=poem_id,
            version=version,
            content_hash=content_hash,
            recorded_at=recorded_at,
            previous_hash=previous_hash,
        ),
        "recorded_at": normalisasi_waktu(recorded_at),
        "algorithm": "SHA-256",
    }
