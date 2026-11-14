from datetime import datetime, timezone
import os
from typing import Any, Dict, Optional
import uuid
from .kontrak import validasi_event


def _nama_layanan(producer: Optional[str]) -> str:
    nama = producer or os.getenv("SERVICE_NAME")
    if not nama:
        raise ValueError("Nama layanan kosong: isi variabel SERVICE_NAME atau parameter producer")
    return nama


def uuidv5(nama: str, namespace: str) -> str:
    ns_uuid = uuid.UUID(namespace)
    return str(uuid.uuid5(ns_uuid, nama))


def buat_event(
    event_type: str,
    aggregate_id: Any,
    aggregate_version: int,
    payload: Dict[str, Any],
    *,
    event_id: Optional[str] = None,
    correlation_id: Optional[str] = None,
    causation_id: Optional[str] = None,
    traceparent: Optional[str] = None,
    schema_version: int = 1,
    producer: Optional[str] = None,
    occurred_at: Optional[str] = None,
) -> Dict[str, Any]:
    waktu = occurred_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    event: Dict[str, Any] = {
        "event_id": event_id or str(uuid.uuid4()),
        "event_type": event_type,
        "schema_version": schema_version,
        "occurred_at": waktu,
        "producer": _nama_layanan(producer),
        "correlation_id": correlation_id or str(uuid.uuid4()),
        "causation_id": causation_id,
        "aggregate_id": str(aggregate_id),
        "aggregate_version": int(aggregate_version),
        "payload": payload,
    }
    if traceparent:
        event["traceparent"] = traceparent
    return validasi_event(event)


def event_turunan(
    sumber: Dict[str, Any],
    event_type: str,
    payload: Dict[str, Any],
    *,
    aggregate_id: Optional[Any] = None,
    aggregate_version: Optional[int] = None,
    producer: Optional[str] = None,
    traceparent: Optional[str] = None,
    schema_version: int = 1,
    occurred_at: Optional[str] = None,
) -> Dict[str, Any]:
    nama_producer = _nama_layanan(producer)
    return buat_event(
        event_type=event_type,
        aggregate_id=aggregate_id if aggregate_id is not None else sumber["aggregate_id"],
        aggregate_version=(
            aggregate_version if aggregate_version is not None else sumber["aggregate_version"]
        ),
        payload=payload,
        event_id=uuidv5(f"{nama_producer}:{event_type}", sumber["event_id"]),
        correlation_id=sumber["correlation_id"],
        causation_id=sumber["event_id"],
        traceparent=traceparent or sumber.get("traceparent"),
        schema_version=schema_version,
        producer=nama_producer,
        occurred_at=occurred_at,
    )
