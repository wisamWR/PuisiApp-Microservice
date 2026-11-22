
from typing import Any

from event_lib import buat_event, uuidv5
from app.config import load_settings
from event_lib.kontrak import validasi_event

EVENT_INPUT = "poem.fingerprint.created"
EVENT_OUTPUT = "poem.similarity.scored"

EVENT_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"


def validasi_fingerprint_event(event: Any) -> dict:
    """Memvalidasi envelope event fingerprint."""
    event = validasi_event(event)

    if event.get("event_type") != EVENT_INPUT:
        raise ValueError(f"Event tidak didukung: {event.get('event_type')}")

    payload = event.get("payload", {})

    required = {
        "poem_id",
        "version",
        "shingle_count",
        "signature",
        "stanza_signatures",
    }

    if not required.issubset(payload):
        raise ValueError("Payload fingerprint tidak lengkap")

    if len(payload["signature"]) != 128:
        raise ValueError("Signature harus memiliki 128 nilai")

    return event


def buat_event_similarity(
    event_sumber: dict,
    hasil_kandidat: list[dict],
) -> dict:
    """Membentuk event hasil scoring sesuai kontrak."""
    payload_sumber = event_sumber["payload"]

    comparisons = [
        {
            "compared_poem_id": item["poem_id"],
            "score": round(item["jaccard_estimate"], 6),
        }
        for item in hasil_kandidat
    ]

    score = max(
        (item["score"] for item in comparisons),
        default=0.0,
    )

    # Perlindungan puisi pendek tetap mengikuti spesifikasi T7.2.
    from app.similarity import tentukan_level

    settings = load_settings()

    level = tentukan_level(
        score,
        payload_sumber["shingle_count"],
        threshold_inspired=settings.threshold_inspired,
        threshold_similar=settings.threshold_similar,
        threshold_plagiarism=settings.threshold_plagiarism,
    )

    payload_hasil = {
        "poem_id": payload_sumber["poem_id"],
        "score": score,
        "level": level,
        "comparisons": comparisons,
    }

    event_id = uuidv5(
        f"puisiapp:similarity-worker:{event_sumber['event_id']}",
        EVENT_NAMESPACE,
    )

    return buat_event(
        event_type=EVENT_OUTPUT,
        aggregate_id=payload_sumber["poem_id"],
        aggregate_version=event_sumber["aggregate_version"],
        payload=payload_hasil,
        event_id=event_id,
        correlation_id=event_sumber["correlation_id"],
        causation_id=event_sumber["event_id"],
        traceparent=event_sumber.get("traceparent"),
        producer="similarity-worker",
    )
