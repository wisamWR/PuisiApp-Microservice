
from types import SimpleNamespace

from app.event import buat_event_fingerprint


def test_event_fingerprint_valid_dan_deterministik():
    settings = SimpleNamespace(
        service_name="fingerprint-worker",
        num_hashes=128,
        hash_seed=42,
        shingle_size=3,
    )

    event_sumber = {
        "event_id": "11111111-1111-4111-8111-111111111111",
        "correlation_id": "22222222-2222-4222-8222-222222222222",
        "event_type": "poem.submitted",
        "aggregate_id": "0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10",
        "aggregate_version": 1,
        "payload": {
            "poem_id": "0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10",
            "version": 1,
            "body": (
                "senja datang perlahan\n"
                "angin menyentuh dedaunan"
            ),
        },
    }

    hasil_pertama = buat_event_fingerprint(event_sumber, settings)
    hasil_kedua = buat_event_fingerprint(event_sumber, settings)

    assert hasil_pertama["event_type"] == "poem.fingerprint.created"
    assert hasil_pertama["event_id"] == hasil_kedua["event_id"]
    assert hasil_pertama["aggregate_id"] == event_sumber["payload"]["poem_id"]
    assert hasil_pertama["aggregate_version"] == 1
    assert hasil_pertama["causation_id"] == event_sumber["event_id"]
    assert hasil_pertama["correlation_id"] == event_sumber["correlation_id"]
    assert len(hasil_pertama["payload"]["signature"]) == 128
