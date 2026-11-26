import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pika
from event_lib import StorePg, buat_konsumen
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.config import load_settings
from app.database import get_connection, jalankan_migrasi
from app.handler import handle_fingerprint

ANTREAN = "q.similarity-worker"
EVENT_INPUT = ["poem.fingerprint.created"]


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/metrics":
            payload = generate_latest()
            self.send_response(200)
            self.send_header("Content-Type", CONTENT_TYPE_LATEST)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if self.path != "/health":
            self.send_error(404, "Not Found")
            return

        settings = load_settings()
        body = json.dumps({
            "status": "ok",
            "service": settings.service_name,
        }).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[HTTP] {format % args}")


def jalankan_konsumen(settings):
    while True:
        connection = None
        db_connection = None

        try:
            if not settings.amqp_url:
                raise ValueError("AMQP_URL belum dikonfigurasi")

            if not settings.database_url:
                raise ValueError("DATABASE_URL belum dikonfigurasi")

            parameter = pika.URLParameters(settings.amqp_url)
            connection = pika.BlockingConnection(parameter)
            channel = connection.channel()

            db_connection = get_connection()
            migrasi = jalankan_migrasi(db_connection)
            if migrasi:
                print(f"[SIMILARITY] Migrasi dijalankan: {', '.join(migrasi)}")
            store = StorePg(db_connection)

            print("[RABBITMQ] Consumer similarity-worker berjalan.")

            buat_konsumen(
                channel,
                antrean=ANTREAN,
                ikatan=EVENT_INPUT,
                store=store,
                handler=handle_fingerprint,
            )

        except Exception as exc:
            print(f"[SIMILARITY] Consumer bermasalah: {exc}")
            print("[SIMILARITY] Mencoba kembali dalam 5 detik...")
            time.sleep(5)

        finally:
            if connection is not None and connection.is_open:
                connection.close()

            if db_connection is not None and not db_connection.closed:
                db_connection.close()


def main():
    settings = load_settings()

    thread_konsumen = threading.Thread(
        target=jalankan_konsumen,
        args=(settings,),
        daemon=True,
    )
    thread_konsumen.start()

    server = ThreadingHTTPServer(
        (settings.host, settings.port),
        HealthHandler,
    )

    print(
        f"{settings.service_name} berjalan "
        f"pada {settings.host}:{settings.port}"
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Server dihentikan")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
