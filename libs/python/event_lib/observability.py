from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest


class _ObservabilityHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        elif self.path == "/metrics":
            output = generate_latest()
            self.send_response(200)
            self.send_header("Content-Type", CONTENT_TYPE_LATEST)
            self.end_headers()
            self.wfile.write(output)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        return


def jalankan_observability(port: int = 8000) -> HTTPServer:
    server = HTTPServer(("0.0.0.0", port), _ObservabilityHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
