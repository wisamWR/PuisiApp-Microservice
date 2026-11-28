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
from .leksikon_tema import KonfigurasiTema, ekstrak_tema, muat_konfigurasi_tema
from .mongo_store import StoreMongoTema

EVENT_DIKONSUMSI = ("poem.submitted", "poem.revised")
EVENT_DITERBITKAN = "poem.themes.extracted"


def ekstrak_data_puisi(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload") or {}
    poem_id = str(payload.get("poem_id") or event.get("aggregate_id") or "").strip()
    if not poem_id:
        raise GalatPermanen("poem_id tidak ditemukan pada event")

    versi_raw = payload.get("version", event.get("aggregate_version", 1))
    version = int(versi_raw)
    judul = str(payload.get("title") or "").strip()
    isi = str(
        payload.get("content")
        or payload.get("body")
        or payload.get("text")
        or payload.get("isi")
        or ""
    ).strip()
    teks_analisis = f"{judul}\n{isi}".strip() if (judul or isi) else ""

    return {
        "poem_id": poem_id,
        "version": version,
        "title": judul,
        "content": teks_analisis,
    }


def buat_handler_tema(
    *,
    store: StoreMongoTema,
    publisher,
    service_name: str,
    konfigurasi: KonfigurasiTema | None = None,
    extractor: Callable[[str], dict[str, Any]] | None = None,
):
    if extractor is None:
        if konfigurasi is None:
            raise ValueError("Isi parameter extractor atau konfigurasi")

        def _ekstrak_yaml(teks: str) -> dict[str, Any]:
            return ekstrak_tema(teks, konfigurasi)

        extractor = _ekstrak_yaml

    def _handler(event: dict[str, Any], _db: Any) -> None:
        data_puisi = ekstrak_data_puisi(event)
        hasil = extractor(data_puisi["content"])

        payload_kontrak = {
            "poem_id": data_puisi["poem_id"],
            "themes": hasil["themes"],
        }

        dokumen_db = {
            "poem_id": data_puisi["poem_id"],
            "version": data_puisi["version"],
            "primary": hasil["primary"],
            "secondary": hasil["secondary"],
            "scores": hasil["scores"],
            "themes": hasil["themes"],
            "title": data_puisi["title"],
            "source_event_id": event["event_id"],
            "analyzed_at": datetime.now(UTC).isoformat(),
        }
        store.simpan_hasil(dokumen_db)

        event_keluar = event_turunan(
            event,
            EVENT_DITERBITKAN,
            payload_kontrak,
            producer=service_name,
        )
        publisher.terbitkan(event_keluar)

    return _handler


def jalankan_worker(settings: Settings) -> None:
    log = buat_logger(settings.service_name)
    konfigurasi = muat_konfigurasi_tema(settings.themes_path)
    log.info(
        "theme-worker siap",
        extra={
            "themes_path": str(settings.themes_path),
            "themes_count": len(konfigurasi.bobot_tema),
        },
    )

    mongo_client = MongoClient(settings.mongo_url)
    db = mongo_client[settings.mongo_db]
    store = StoreMongoTema(db)

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
            handler = buat_handler_tema(
                store=store,
                publisher=publisher,
                konfigurasi=konfigurasi,
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
