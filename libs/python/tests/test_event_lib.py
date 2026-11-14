import json
from unittest.mock import MagicMock
from event_lib import (
    create_event_envelope,
    process_message_with_idempotency,
)
from event_lib.publisher import resolve_exchange


def test_envelope_has_required_fields_and_deterministic_uuid():
    env1 = create_event_envelope(
        event_type="poem.emotion.analyzed",
        producer="emotion-worker",
        correlation_id="corr-123",
        aggregate_id="poem-1",
        aggregate_version=1,
        payload={"dominant_emotion": "senang"},
    )
    env2 = create_event_envelope(
        event_type="poem.emotion.analyzed",
        producer="emotion-worker",
        correlation_id="corr-999",
        aggregate_id="poem-1",
        aggregate_version=1,
        payload={"dominant_emotion": "senang"},
    )

    required = {
        "event_id", "event_type", "schema_version", "occurred_at",
        "producer", "correlation_id", "aggregate_id", "aggregate_version", "payload"
    }
    assert required.issubset(env1.keys())
    assert env1["event_id"] == env2["event_id"]


def test_resolve_exchange_from_routing_json(tmp_path):
    routing_file = tmp_path / "routing.json"
    routing_file.write_text(json.dumps({"poem.emotion.analyzed": "mood.events"}), encoding="utf-8")

    ex = resolve_exchange("poem.emotion.analyzed", routing_path=str(routing_file))
    assert ex == "mood.events"


def test_duplicate_event_is_ignored():
    mock_conn = MagicMock()
    mock_cursor = mock_conn.cursor.return_value.__enter__.return_value
    mock_cursor.fetchone.return_value = (1,)

    handler = MagicMock()
    event = {"event_id": "uuid-1", "aggregate_id": "poem-1", "aggregate_version": 1}

    status = process_message_with_idempotency(mock_conn, event, handler)
    assert status == "duplicate"
    handler.assert_not_called()


def test_stale_version_event_is_ignored():
    mock_conn = MagicMock()
    mock_cursor = mock_conn.cursor.return_value.__enter__.return_value
    mock_cursor.fetchone.return_value = None

    handler = MagicMock()
    event = {"event_id": "uuid-lama", "aggregate_id": "poem-1", "aggregate_version": 3}

    # Simulasi versi tersimpan sudah lebih baru (versi 5), sehingga versi 3 ditolak
    status = process_message_with_idempotency(
        mock_conn, event, handler, is_newer_version=lambda cur, agg_id, ver: ver > 5
    )
    assert status == "stale"
    handler.assert_not_called()
