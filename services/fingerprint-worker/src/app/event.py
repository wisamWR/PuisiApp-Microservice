
from event_lib import buat_event, uuidv5

from app.fingerprint import buat_payload_fingerprint


# Namespace URL standar, digunakan secara tetap untuk UUIDv5.
FINGERPRINT_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"


def buat_event_fingerprint(event_sumber: dict, settings) -> dict:
    """Membuat event poem.fingerprint.created dari event puisi sumber."""
    data = event_sumber["payload"]

    poem_id = data["poem_id"]
    version = data["version"]

    payload = buat_payload_fingerprint(
        poem_id=poem_id,
        version=version,
        body=data["body"],
        jumlah_hash=settings.num_hashes,
        seed=settings.hash_seed,
        ukuran_shingle=settings.shingle_size,
    )

    nama_event = f"puisiapp:fingerprint-worker:{poem_id}:{version}"
    event_id = uuidv5(nama_event, FINGERPRINT_NAMESPACE)

    return buat_event(
        event_type="poem.fingerprint.created",
        aggregate_id=poem_id,
        aggregate_version=version,
        payload=payload,
        event_id=event_id,
        correlation_id=event_sumber["correlation_id"],
        causation_id=event_sumber["event_id"],
        traceparent=event_sumber.get("traceparent"),
        producer=settings.service_name,
    )
