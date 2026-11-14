import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

NAMESPACE_PUISI = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def generate_deterministic_event_id(
    producer: str,
    event_type: str,
    aggregate_id: str,
    aggregate_version: int,
) -> str:
    seed = f"{producer}:{event_type}:{aggregate_id}:{aggregate_version}"
    return str(uuid.uuid5(NAMESPACE_PUISI, seed))


def create_event_envelope(
    event_type: str,
    producer: str,
    correlation_id: str,
    aggregate_id: str,
    aggregate_version: int,
    payload: Dict[str, Any],
    schema_version: str = "1.0",
    causation_id: Optional[str] = None,
    traceparent: Optional[str] = None,
) -> Dict[str, Any]:
    envelope: Dict[str, Any] = {
        "event_id": generate_deterministic_event_id(
            producer, event_type, str(aggregate_id), aggregate_version
        ),
        "event_type": event_type,
        "schema_version": schema_version,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "producer": producer,
        "correlation_id": correlation_id,
        "aggregate_id": str(aggregate_id),
        "aggregate_version": aggregate_version,
        "payload": payload,
    }
    if causation_id:
        envelope["causation_id"] = causation_id
    if traceparent:
        envelope["traceparent"] = traceparent
    return envelope
