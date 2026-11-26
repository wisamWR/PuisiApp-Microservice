from types import SimpleNamespace

import pytest

import app.event as event_module
from app.event import buat_event_similarity, validasi_fingerprint_event


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


def siapkan_event_similarity(monkeypatch, whole_jaccard):
    settings = SimpleNamespace(
        threshold_inspired=0.20,
        threshold_similar=0.50,
        threshold_plagiarism=0.80,
        min_whole_jaccard_for_plagiarism=0.80,
    )

    monkeypatch.setattr(
        event_module,
        "load_settings",
        lambda: settings,
    )

    # Mengisolasi pengujian klasifikasi dari pembentukan envelope.
    monkeypatch.setattr(
        event_module,
        "buat_event",
        lambda **kwargs: kwargs,
    )

    event_sumber = {
        "event_id": "00000000-0000-0000-0000-000000000001",
        "aggregate_version": 1,
        "correlation_id": "00000000-0000-0000-0000-000000000002",
        "payload": {
            "poem_id": "00000000-0000-0000-0000-000000000003",
            "shingle_count": 20,
        },
    }

    hasil_kandidat = [
        {
            "poem_id": "poem-pembanding",
            "score": 0.90,
            "whole_jaccard_estimate": whole_jaccard,
        }
    ]

    return event_sumber, hasil_kandidat


def test_plagiarisme_diturunkan_jika_whole_jaccard_di_bawah_080(
    monkeypatch,
):
    event_sumber, hasil_kandidat = siapkan_event_similarity(
        monkeypatch,
        whole_jaccard=0.79,
    )

    hasil = buat_event_similarity(event_sumber, hasil_kandidat)

    assert hasil["payload"]["level"] == "similar"


def test_plagiarisme_dipertahankan_jika_whole_jaccard_minimal_080(
    monkeypatch,
):
    event_sumber, hasil_kandidat = siapkan_event_similarity(
        monkeypatch,
        whole_jaccard=0.80,
    )

    hasil = buat_event_similarity(event_sumber, hasil_kandidat)

    assert hasil["payload"]["level"] == "suspected_plagiarism"
