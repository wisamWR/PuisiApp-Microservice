
from app.database import simpan_fingerprint
from app.event import buat_event_similarity, validasi_fingerprint_event
from app.outbox import simpan_outbox
from app.processor import proses_kandidat


def handle_fingerprint(event: dict, cur) -> None:
    """Memproses fingerprint dan menyimpan event hasil scoring ke Outbox."""
    event = validasi_fingerprint_event(event)
    payload = event["payload"]

    kandidat = proses_kandidat(cur, payload)

    event_hasil = buat_event_similarity(event, kandidat)

    simpan_fingerprint(cur, payload)
    simpan_outbox(cur, event_hasil)

    print(
        "[SIMILARITY] Berhasil diproses "
        f"poem_id={payload['poem_id']} "
        f"score={event_hasil['payload']['score']} "
        f"level={event_hasil['payload']['level']}"
    )
