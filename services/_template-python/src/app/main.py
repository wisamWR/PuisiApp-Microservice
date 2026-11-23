import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.config import load_settings


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
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


def main():
    settings = load_settings()

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
