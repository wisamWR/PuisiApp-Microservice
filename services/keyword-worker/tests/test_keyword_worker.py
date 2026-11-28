import json
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import jsonschema

# Stub event_lib agar unit test berjalan di CI tanpa harus pip install libs/python
if "event_lib" not in sys.modules:
    stub = types.ModuleType("event_lib")

    class _GalatPermanen(Exception):
        pass

    def _event_turunan(event_induk, event_type, payload, producer="keyword-worker"):
        return {
            "event_id": "00000000-0000-4000-8000-000000000099",
            "event_type": event_type,
            "schema_version": 1,
            "occurred_at": "2026-11-27T08:00:00Z",
            "producer": producer,
            "correlation_id": event_induk.get("correlation_id", "corr-1"),
            "causation_id": event_induk["event_id"],
            "aggregate_type": "poem",
            "aggregate_id": payload["poem_id"],
            "aggregate_version": event_induk.get("aggregate_version", 1),
            "payload": payload,
        }

    stub.GalatPermanen = _GalatPermanen
    stub.event_turunan = _event_turunan
    stub.buat_konsumen = MagicMock()
    stub.buat_logger = MagicMock()
    stub.buat_publisher = MagicMock()
    sys.modules["event_lib"] = stub

from app.ekstraktor_keyword import ekstrak_kata_kunci, stem_kata, tokenisasi_dan_stem  # noqa: E402
from app.worker import buat_handler_keyword  # noqa: E402


def test_stemming_sastrawi_dan_stopword():
    assert stem_kata("merindukanmu") == "rindu"
    assert stem_kata("kesepian") == "sepi"
    assert stem_kata("perjuangan") == "juang"

    tokens = tokenisasi_dan_stem("Aku selalu merindukan hujan yang turun di malam hari")
    assert "rindu" in tokens
    assert "hujan" in tokens
    assert "malam" in tokens
    assert "aku" not in tokens
    assert "yang" not in tokens


def test_ekstraksi_tfidf_mengurutkan_kata_kunci_relevan():
    puisi = (
        "Cakrawala senja memeluk cakrawala, "
        "cakrawala merah menyapa samudra tenang di ujung dermaga."
    )
    hasil = ekstrak_kata_kunci(puisi, max_keywords=4)
    assert len(hasil["keywords"]) == 4
    assert hasil["keywords"][0] == "cakrawala"
    assert hasil["scores"]["cakrawala"] >= hasil["scores"][hasil["keywords"][1]]


def test_ekstraksi_puisi_kosong_tetap_aman():
    hasil = ekstrak_kata_kunci("dan di ke dari")
    assert hasil["keywords"] == ["puisi"]


def test_handler_menyimpan_dan_menerbitkan_sesuai_kontrak():
    schema_path = (
        Path(__file__).resolve().parents[3]
        / "contracts"
        / "events"
        / "poem.keywords.extracted.v1.json"
    )
    schema = json.loads(schema_path.read_text(encoding="utf-8"))

    store = MagicMock()
    store.statistik_korpus.return_value = ({}, 0)
    publisher = MagicMock()

    handler = buat_handler_keyword(
        store=store,
        publisher=publisher,
        service_name="keyword-worker",
        max_keywords=3,
    )

    event_masuk = {
        "event_id": "11111111-1111-4111-8111-111111111111",
        "event_type": "poem.submitted",
        "schema_version": 1,
        "occurred_at": "2026-11-27T07:00:00Z",
        "producer": "poem-service",
        "correlation_id": "corr-abc",
        "aggregate_type": "poem",
        "aggregate_id": "poem-123",
        "aggregate_version": 1,
        "payload": {
            "poem_id": "poem-123",
            "version": 1,
            "title": "Hujan di Jendela",
            "content": "Rintik hujan mengetuk jendela, membawa rindu yang tak pernah padam.",
        },
    }

    handler(event_masuk, None)

    store.simpan_hasil.assert_called_once()
    dok_tersimpan = store.simpan_hasil.call_args[0][0]
    assert dok_tersimpan["poem_id"] == "poem-123"
    assert dok_tersimpan["version"] == 1
    assert len(dok_tersimpan["keywords"]) == 3

    publisher.terbitkan.assert_called_once()
    event_keluar = publisher.terbitkan.call_args[0][0]
    assert event_keluar["event_type"] == "poem.keywords.extracted"
    jsonschema.validate(instance=event_keluar["payload"], schema=schema)
