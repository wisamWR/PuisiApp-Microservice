import json
import os
import random
from typing import Any, Callable, Dict, Iterable, Optional
import pika
from .galat import apakah_permanen
from .kontrak import validasi_event
from .log import buat_logger, trace_id_dari
from .topologi import EXCHANGE_RETRY, pastikan_antrean

HEADER_PERCOBAAN = "x-percobaan"
BAWAAN_PREFETCH = 10
BAWAAN_MAKS_PERCOBAAN = 3
BAWAAN_JEDA_DASAR_MS = 2000
BAWAAN_FAKTOR = 4


def _angka_env(nama: str, cadangan: int) -> int:
    nilai = os.getenv(nama)
    if nilai and nilai.isdigit() and int(nilai) > 0:
        return int(nilai)
    return cadangan


def tangani_pesan(
    body: bytes,
    properties: Optional[pika.BasicProperties],
    *,
    store,
    handler: Callable[[Dict[str, Any], Any], None],
    versi_tersimpan: Optional[Callable[[Dict[str, Any], Any], Optional[int]]] = None,
    ack: Callable[[], None],
    ke_dlq: Callable[[], None],
    kembalikan: Callable[[], None],
    jadwalkan_ulang: Callable[[int, int], None],
    log=None,
    maks_percobaan: int = BAWAAN_MAKS_PERCOBAAN,
    jeda_dasar_ms: int = BAWAAN_JEDA_DASAR_MS,
    faktor: int = BAWAAN_FAKTOR,
    acak: Callable[[], float] = random.random,
) -> str:
    logger = log or buat_logger()
    try:
        event = validasi_event(json.loads(body.decode("utf-8")))
    except Exception as exc:
        logger.error("pesan tidak valid, dipindah ke DLQ", extra={"err": str(exc)})
        ke_dlq()
        return "tidak_valid"

    headers = (properties.headers if properties and properties.headers else {}) or {}
    percobaan = int(headers.get(HEADER_PERCOBAAN, 0) or 0)
    konteks = {
        "event_id": event["event_id"],
        "event_type": event["event_type"],
        "correlation_id": event["correlation_id"],
        "trace_id": trace_id_dari(event.get("traceparent")),
        "aggregate_id": event["aggregate_id"],
    }

    try:
        hasil = store.proses(event, handler, versi_tersimpan=versi_tersimpan)
        if hasil == "duplikat":
            logger.info("event duplikat diabaikan", extra=konteks)
        elif hasil == "basi":
            logger.warning("event basi diabaikan", extra=konteks)
        else:
            logger.debug("event diproses", extra=konteks)
        ack()
        return hasil
    except Exception as exc:
        if apakah_permanen(exc):
            logger.error("galat permanen, dipindah ke DLQ", extra=konteks)
            ke_dlq()
            return "dlq"
        if percobaan >= maks_percobaan:
            logger.error("percobaan habis, dipindah ke DLQ", extra=konteks)
            ke_dlq()
            return "dlq"

        jeda_ms = int(acak() * jeda_dasar_ms * (faktor**percobaan))
        try:
            jadwalkan_ulang(percobaan + 1, jeda_ms)
            logger.warning(
                f"galat sementara, dijadwalkan ulang percobaan={percobaan + 1} jeda_ms={jeda_ms}",
                extra=konteks,
            )
            ack()
            return "retry"
        except Exception:
            logger.error("gagal menjadwalkan retry, pesan dikembalikan ke queue", extra=konteks)
            kembalikan()
            return "dikembalikan"


def buat_konsumen(
    channel: pika.adapters.blocking_connection.BlockingChannel,
    *,
    antrean: str,
    ikatan: Iterable[str],
    store,
    handler: Callable[[Dict[str, Any], Any], None],
    versi_tersimpan: Optional[Callable[[Dict[str, Any], Any], Optional[int]]] = None,
    prefetch: Optional[int] = None,
    maks_percobaan: int = BAWAAN_MAKS_PERCOBAAN,
    jeda_dasar_ms: int = BAWAAN_JEDA_DASAR_MS,
    faktor: int = BAWAAN_FAKTOR,
    log=None,
) -> None:
    logger = log or buat_logger()
    nilai_prefetch = prefetch if prefetch is not None else _angka_env("PREFETCH", BAWAAN_PREFETCH)
    channel.confirm_delivery()
    channel.basic_qos(prefetch_count=nilai_prefetch)
    pastikan_antrean(channel, antrean, ikatan)

    def _callback(ch, method, properties, body):
        def _jadwalkan_ulang(percobaan_baru: int, jeda_ms: int) -> None:
            hdr = dict((properties.headers if properties and properties.headers else {}) or {})
            hdr[HEADER_PERCOBAAN] = percobaan_baru
            hdr["x-delay"] = jeda_ms
            props = pika.BasicProperties(
                delivery_mode=2,
                content_type=getattr(properties, "content_type", "application/json"),
                content_encoding=getattr(properties, "content_encoding", "utf-8"),
                message_id=getattr(properties, "message_id", None),
                correlation_id=getattr(properties, "correlation_id", None),
                type=getattr(properties, "type", None),
                app_id=getattr(properties, "app_id", None),
                headers=hdr,
            )
            ch.basic_publish(
                exchange=EXCHANGE_RETRY,
                routing_key=antrean,
                body=body,
                properties=props,
            )

        tangani_pesan(
            body,
            properties,
            store=store,
            handler=handler,
            versi_tersimpan=versi_tersimpan,
            ack=lambda: ch.basic_ack(delivery_tag=method.delivery_tag),
            ke_dlq=lambda: ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False),
            kembalikan=lambda: ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True),
            jadwalkan_ulang=_jadwalkan_ulang,
            log=logger,
            maks_percobaan=maks_percobaan,
            jeda_dasar_ms=jeda_dasar_ms,
            faktor=faktor,
        )

    channel.basic_consume(queue=antrean, on_message_callback=_callback, auto_ack=False)
    logger.info(f"konsumen berjalan di {antrean} (prefetch={nilai_prefetch})")
    channel.start_consuming()
