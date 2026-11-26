import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pika
from event_lib import StoreTanpaDb, buat_konsumen, buat_publisher
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.config import load_settings
from app.event import buat_event_fingerprint

ANTREAN = "q.fingerprint-worker"

EVENT_INPUT = [
    "poem.submitted",
    "poem.revised",
]


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
        response = {
            "status": "ok",
            "service": settings.service_name,
        }

        body = json.dumps(response).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[HTTP] {format % args}")


def jalankan_konsumen(settings):
    """Mengonsumsi puisi dan menerbitkan fingerprint."""
    while True:
        connection = None

        try:
            if not settings.amqp_url:
                raise ValueError("AMQP_URL belum dikonfigurasi")

            parameter = pika.URLParameters(settings.amqp_url)
            connection = pika.BlockingConnection(parameter)
            channel = connection.channel()

            publisher = buat_publisher(channel)
            store = StoreTanpaDb()

            def handler(event, _):
                event_hasil = buat_event_fingerprint(event, settings)
                publisher.terbitkan(event_hasil)

                print(
                    "[FINGERPRINT] Berhasil menerbitkan "
                    f"poem_id={event_hasil['payload']['poem_id']} "
                    f"version={event_hasil['payload']['version']}"
                )

            print("[RABBITMQ] Terhubung. Consumer mulai berjalan.")

            buat_konsumen(
                channel,
                antrean=ANTREAN,
                ikatan=EVENT_INPUT,
                store=store,
                handler=handler,
            )

        except Exception as exc:
            print(f"[RABBITMQ] Koneksi atau consumer bermasalah: {exc}")
            print("[RABBITMQ] Mencoba kembali dalam 5 detik...")
            time.sleep(5)

        finally:
            if connection is not None and connection.is_open:
                connection.close()


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
