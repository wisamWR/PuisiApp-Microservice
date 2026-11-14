import json
import logging
from unittest.mock import MagicMock
import pika
import pytest
from event_lib import (
    GalatPermanen,
    StorePg,
    buat_event,
    buat_konsumen,
    buat_publisher,
    event_turunan,
    exchange_untuk,
    pastikan_antrean,
    tangani_pesan,
    uuidv5,
    validasi_event,
)
from event_lib.log import JsonFormatter


def test_kontrak_asli_validasi_dan_routing():
    evt = buat_event(
        "poem.submitted",
        aggregate_id="poem-42",
        aggregate_version=1,
        payload={"title": "Hujan", "content": "Rintik hujan di jendela"},
        producer="poem-create-service",
        traceparent="00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    )
    assert validasi_event(evt)["event_id"] == evt["event_id"]
    assert exchange_untuk("poem.submitted") == "poem.events"
    assert exchange_untuk("poem.emotion.analyzed") == "analysis.events"


def test_validasi_skema_menolak_amplop_cacat():
    with pytest.raises(GalatPermanen):
        validasi_event({"event_id": "bukan-uuid", "event_type": "poem.submitted"})

    evt_ekstra = buat_event(
        "poem.submitted",
        aggregate_id="poem-1",
        aggregate_version=1,
        payload={},
        producer="test",
    )
    evt_ekstra["field_liar"] = True
    with pytest.raises(GalatPermanen):
        validasi_event(evt_ekstra)


def test_event_turunan_deterministik_dan_mewarisi_konteks():
    sumber = buat_event(
        "poem.submitted",
        aggregate_id="poem-99",
        aggregate_version=2,
        payload={"content": "Cahaya pagi"},
        producer="poem-create-service",
        correlation_id="11111111-1111-4111-8111-111111111111",
        traceparent="00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    )
    turunan1 = event_turunan(
        sumber,
        "poem.emotion.analyzed",
        {"dominant_emotion": "senang"},
        producer="emotion-worker",
    )
    turunan2 = event_turunan(
        sumber,
        "poem.emotion.analyzed",
        {"dominant_emotion": "senang"},
        producer="emotion-worker",
    )

    expected_id = uuidv5("emotion-worker:poem.emotion.analyzed", sumber["event_id"])
    assert turunan1["event_id"] == expected_id
    assert turunan1["event_id"] == turunan2["event_id"]
    assert turunan1["correlation_id"] == sumber["correlation_id"]
    assert turunan1["causation_id"] == sumber["event_id"]
    assert turunan1["traceparent"] == sumber["traceparent"]


def test_publisher_confirm_dan_header_amqp():
    ch = MagicMock()
    pub = buat_publisher(ch)
    ch.confirm_delivery.assert_called_once()

    evt = buat_event(
        "poem.emotion.analyzed",
        aggregate_id="poem-1",
        aggregate_version=1,
        payload={"dominant_emotion": "senang"},
        producer="emotion-worker",
        traceparent="00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    )
    pub.terbitkan(evt)

    ch.basic_publish.assert_called_once()
    kwargs = ch.basic_publish.call_args.kwargs
    assert kwargs["exchange"] == "analysis.events"
    assert kwargs["routing_key"] == "poem.emotion.analyzed"
    assert kwargs["mandatory"] is True
    assert kwargs["properties"].headers["correlation_id"] == evt["correlation_id"]
    assert kwargs["properties"].headers["traceparent"] == evt["traceparent"]


def test_topologi_quorum_dlx_delivery_limit_dan_prefetch_env(monkeypatch):
    ch = MagicMock()
    pastikan_antrean(ch, "q.emotion-worker", ["poem.submitted"])

    dekl_antrean = {
        call.kwargs["queue"]: call.kwargs["arguments"]
        for call in ch.queue_declare.call_args_list
    }
    assert dekl_antrean["q.emotion-worker.dlq"] == {"x-queue-type": "quorum"}
    assert dekl_antrean["q.emotion-worker"] == {
        "x-queue-type": "quorum",
        "x-dead-letter-exchange": "dlx",
        "x-dead-letter-routing-key": "q.emotion-worker.dlq",
        "x-delivery-limit": 5,
    }

    monkeypatch.setenv("PREFETCH", "25")
    ch_konsumen = MagicMock()
    buat_konsumen(
        ch_konsumen,
        antrean="q.emotion-worker",
        ikatan=["poem.submitted"],
        store=MagicMock(),
        handler=MagicMock(),
    )
    ch_konsumen.basic_qos.assert_called_once_with(prefetch_count=25)


def test_store_pg_duplikat_dan_event_basi_tetap_dicatat():
    pg_dup = MagicMock()
    cur_dup = pg_dup.cursor.return_value.__enter__.return_value
    cur_dup.rowcount = 0
    store_dup = StorePg(pg_dup)

    evt = buat_event(
        "poem.submitted",
        aggregate_id="poem-1",
        aggregate_version=2,
        payload={},
        producer="test",
    )
    handler = MagicMock()
    assert store_dup.proses(evt, handler) == "duplikat"
    assert "ON CONFLICT (event_id) DO NOTHING" in cur_dup.execute.call_args_list[0].args[0]
    handler.assert_not_called()

    pg_stale = MagicMock()
    cur_stale = pg_stale.cursor.return_value.__enter__.return_value
    cur_stale.rowcount = 1
    store_stale = StorePg(pg_stale)

    status = store_stale.proses(evt, handler, versi_tersimpan=lambda e, c: 5)
    assert status == "basi"
    handler.assert_not_called()
    pg_stale.__exit__.assert_called_once()


def test_konsumen_retry_dlq_dan_galat_permanen():
    evt = buat_event(
        "poem.submitted",
        aggregate_id="poem-1",
        aggregate_version=1,
        payload={},
        producer="test",
    )
    body = json.dumps(evt).encode("utf-8")

    store_err = MagicMock()
    store_err.proses.side_effect = RuntimeError("DB timeout")
    ack, dlq, retry = MagicMock(), MagicMock(), MagicMock()

    res_retry = tangani_pesan(
        body,
        pika.BasicProperties(headers={}),
        store=store_err,
        handler=MagicMock(),
        ack=ack,
        ke_dlq=dlq,
        kembalikan=MagicMock(),
        jadwalkan_ulang=retry,
        acak=lambda: 0.5,
    )
    assert res_retry == "retry"
    retry.assert_called_once_with(1, 1000)
    ack.assert_called_once()
    dlq.assert_not_called()

    ack2, dlq2, retry2 = MagicMock(), MagicMock(), MagicMock()
    res_exhausted = tangani_pesan(
        body,
        pika.BasicProperties(headers={"x-percobaan": 3}),
        store=store_err,
        handler=MagicMock(),
        ack=ack2,
        ke_dlq=dlq2,
        kembalikan=MagicMock(),
        jadwalkan_ulang=retry2,
    )
    assert res_exhausted == "dlq"
    dlq2.assert_called_once()
    retry2.assert_not_called()

    store_perm = MagicMock()
    store_perm.proses.side_effect = GalatPermanen("Payload rusak")
    ack3, dlq3, retry3 = MagicMock(), MagicMock(), MagicMock()
    res_perm = tangani_pesan(
        body,
        pika.BasicProperties(headers={}),
        store=store_perm,
        handler=MagicMock(),
        ack=ack3,
        ke_dlq=dlq3,
        kembalikan=MagicMock(),
        jadwalkan_ulang=retry3,
    )
    assert res_perm == "dlq"
    dlq3.assert_called_once()
    retry3.assert_not_called()


def test_log_json_selaras_dengan_node():
    formatter = JsonFormatter("emotion-worker")
    rec = logging.LogRecord("emotion-worker", logging.INFO, __file__, 1, "event diproses", (), None)
    rec.correlation_id = "corr-1"
    rec.event_id = "evt-1"
    parsed = json.loads(formatter.format(rec))
    assert {"ts", "level", "service", "msg", "correlation_id", "event_id"}.issubset(parsed.keys())
    assert parsed["service"] == "emotion-worker"
    assert parsed["msg"] == "event diproses"
