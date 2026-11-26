import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pika
from event_lib import StorePg, buat_konsumen, buat_publisher

from app.config import load_settings
from app.database import get_connection, jalankan_migrasi, simpan_catatan, versi_tersimpan
from app.event import buat_event_authorship

ANTREAN = "q.authorship-worker"
EVENT_INPUT = ["poem.submitted", "poem.revised"]


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return

        body = json.dumps(
            {
                "status": "ok",
                "service": "authorship-worker",
            }
        ).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[HTTP] {format % args}")


def jalankan_migrasi_awal():
    while True:
        conn = None
        try:
            conn = get_connection()
            diterapkan = jalankan_migrasi(conn)
            if diterapkan:
                print(f"[DB] Migrasi authorship-worker diterapkan: {', '.join(diterapkan)}")
            else:
                print("[DB] Migrasi authorship-worker sudah up-to-date.")
            return
        except Exception as exc:
            print(f"[DB] Migrasi gagal: {exc}")
            print("[DB] Mencoba migrasi kembali dalam 5 detik...")
            time.sleep(5)
        finally:
            if conn is not None and not conn.closed:
                conn.close()


def jalankan_konsumen(settings):
    while True:
        connection = None
        db = None

        try:
            if not settings.amqp_url:
                raise ValueError("AMQP_URL belum dikonfigurasi")

            db = get_connection()
            connection = pika.BlockingConnection(pika.URLParameters(settings.amqp_url))
            channel = connection.channel()

            publisher = buat_publisher(channel)
            store = StorePg(db)

            def handler(event, cur):
                catatan = simpan_catatan(event, cur)
                event_hasil = buat_event_authorship(event, catatan, settings)
                publisher.terbitkan(event_hasil)

                print(
                    f"[AUTHORSHIP] Tercatat: "
                    f"poem_id={catatan['poem_id']} "
                    f"version={catatan['version']} "
                    f"hash={catatan['chain_hash']}"
                )

            print("[RABBITMQ] Authorship worker aktif.")

            buat_konsumen(
                channel,
                antrean=ANTREAN,
                ikatan=EVENT_INPUT,
                store=store,
                handler=handler,
                versi_tersimpan=versi_tersimpan,
            )

        except Exception as exc:
            print(f"[WORKER] Kesalahan: {exc}")
            print("[WORKER] Mencoba kembali dalam 5 detik...")
            time.sleep(5)

        finally:
            if connection is not None and connection.is_open:
                connection.close()
            if db is not None and not db.closed:
                db.close()


def main():
    settings = load_settings()
    jalankan_migrasi_awal()

    thread = threading.Thread(
        target=jalankan_konsumen,
        args=(settings,),
        daemon=True,
    )
    thread.start()

    server = ThreadingHTTPServer(
        (settings.host, settings.port),
        HealthHandler,
    )

    print(f"{settings.service_name} berjalan pada {settings.host}:{settings.port}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Worker dihentikan.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
