import pytest

from app.event import validasi_fingerprint_event


def test_menerima_event_fingerprint_valid():
    event = {
        "event_id": "00000000-0000-0000-0000-000000000001",
        "event_type": "poem.fingerprint.created",
        "schema_version": 1,
        "occurred_at": "2026-11-20T08:00:00Z",
        "producer": "fingerprint-worker",
        "correlation_id": "00000000-0000-0000-0000-000000000002",
        "causation_id": None,
        "aggregate_id": "00000000-0000-0000-0000-000000000003",
        "aggregate_version": 1,
        "payload": {
            "poem_id": "00000000-0000-0000-0000-000000000003",
            "version": 1,
            "shingle_count": 20,
            "signature": [10] * 128,
            "stanza_signatures": [],
        },
    }

    assert validasi_fingerprint_event(event) == event


def test_menolak_event_type_yang_salah():
    event = {
        "event_id": "00000000-0000-0000-0000-000000000001",
        "event_type": "poem.submitted",
        "schema_version": 1,
        "occurred_at": "2026-11-20T08:00:00Z",
        "producer": "test",
        "correlation_id": "00000000-0000-0000-0000-000000000002",
        "causation_id": None,
        "aggregate_id": "poem-1",
        "aggregate_version": 1,
        "payload": {},
    }

    with pytest.raises(ValueError):
        validasi_fingerprint_event(event)


def test_menolak_signature_bukan_128_nilai():
    event = {
        "event_id": "00000000-0000-0000-0000-000000000001",
        "event_type": "poem.fingerprint.created",
        "schema_version": 1,
        "occurred_at": "2026-11-20T08:00:00Z",
        "producer": "fingerprint-worker",
        "correlation_id": "00000000-0000-0000-0000-000000000002",
        "causation_id": None,
        "aggregate_id": "poem-1",
        "aggregate_version": 1,
        "payload": {
            "poem_id": "00000000-0000-0000-0000-000000000003",
            "version": 1,
            "shingle_count": 20,
            "signature": [10] * 10,
            "stanza_signatures": [],
        },
    }

    with pytest.raises(ValueError):
        validasi_fingerprint_event(event)
