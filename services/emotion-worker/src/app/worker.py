import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import pika
from event_lib import (
    GalatPermanen,
    buat_konsumen,
    buat_logger,
    buat_publisher,
    event_turunan,
)
from pymongo import MongoClient

from .config import Settings
from .indobert import PredictorIndoBERT
from .leksikon import analisis_puisi, muat_kamus
from .mongo_store import StoreMongoEmosi

EVENT_DIKONSUMSI = ("poem.submitted", "poem.revised")
EVENT_DITERBITKAN = "poem.emotion.analyzed"


def ekstrak_data_puisi(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload") or {}
    poem_id = str(payload.get("poem_id") or event.get("aggregate_id") or "").strip()
    if not poem_id:
        raise GalatPermanen("poem_id tidak ditemukan pada event")

    versi_raw = payload.get("version", event.get("aggregate_version", 1))
    version = int(versi_raw)
    judul = str(payload.get("title") or "").strip()
    isi = str(payload.get("content") or payload.get("body") or payload.get("text") or "").strip()
    teks_analisis = isi if isi else judul

    return {
        "poem_id": poem_id,
        "version": version,
        "title": judul,
        "content": teks_analisis,
    }


def buat_fungsi_analisis(settings: Settings) -> Callable[[str], dict[str, Any]]:
    if settings.model_mode == "indobert":
        predictor = PredictorIndoBERT(settings.indobert_model_dir)
        return predictor.analisis_puisi
    kamus = muat_kamus(settings.lexicon_path)
    return lambda teks: analisis_puisi(teks, kamus)


def buat_handler_emosi(
    *,
    store: StoreMongoEmosi,
    publisher,
    service_name: str,
    kamus: dict[str, set[str]] | None = None,
    analyzer: Callable[[str], dict[str, Any]] | None = None,
):
    if analyzer is None:
        if kamus is None:
            raise ValueError("Isi parameter analyzer atau kamus")
        analyzer = lambda teks: analisis_puisi(teks, kamus)

    def _handler(event: dict[str, Any], _db: Any) -> None:
        data_puisi = ekstrak_data_puisi(event)
        hasil = analyzer(data_puisi["content"])

        payload_keluar = {
            "poem_id": data_puisi["poem_id"],
            "version": data_puisi["version"],
            "lines": hasil["lines"],
            "poem_scores": hasil["poem_scores"],
            "dominant": hasil["dominant"],
            "model": hasil["model"],
        }

        dokumen_db = {
            **payload_keluar,
            "title": data_puisi["title"],
            "source_event_id": event["event_id"],
            "analyzed_at": datetime.now(UTC).isoformat(),
        }
        store.simpan_hasil(dokumen_db)

        event_keluar = event_turunan(
            event,
            EVENT_DITERBITKAN,
            payload_keluar,
            producer=service_name,
        )
        publisher.terbitkan(event_keluar)

    return _handler


def jalankan_worker(settings: Settings) -> None:
    log = buat_logger(settings.service_name)
    analyzer = buat_fungsi_analisis(settings)
    log.info("emotion-worker siap", extra={"model_mode": settings.model_mode})

    mongo_client = MongoClient(settings.mongo_url)
    db = mongo_client[settings.mongo_db]
    store = StoreMongoEmosi(db)

    credentials = pika.PlainCredentials(settings.rabbitmq_user, settings.rabbitmq_pass)
    params = pika.ConnectionParameters(
        host=settings.rabbitmq_host,
        port=settings.rabbitmq_port,
        virtual_host=settings.rabbitmq_vhost,
        credentials=credentials,
        heartbeat=60,
    )

    while True:
        try:
            conn = pika.BlockingConnection(params)
            ch_pub = conn.channel()
            ch_sub = conn.channel()
            publisher = buat_publisher(ch_pub)
            handler = buat_handler_emosi(
                store=store,
                publisher=publisher,
                analyzer=analyzer,
                service_name=settings.service_name,
            )

            buat_konsumen(
                ch_sub,
                antrean=f"q.{settings.service_name}",
                ikatan=EVENT_DIKONSUMSI,
                store=store,
                handler=handler,
                versi_tersimpan=lambda evt, _db: store.versi_terakhir(
                    str((evt.get("payload") or {}).get("poem_id") or evt["aggregate_id"])
                ),
                prefetch=settings.prefetch,
                log=log,
            )
        except KeyboardInterrupt:
            break
        except Exception as exc:
            log.error("koneksi RabbitMQ terputus, mencoba ulang 3 detik", extra={"err": str(exc)})
            time.sleep(3)
