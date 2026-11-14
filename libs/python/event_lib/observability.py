import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_payload = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "correlation_id": getattr(record, "correlation_id", ""),
            "event_id": getattr(record, "event_id", ""),
            "trace_id": getattr(record, "trace_id", ""),
        }
        return json.dumps(log_payload)


def setup_logger(service_name: str) -> logging.Logger:
    logger = logging.getLogger(service_name)
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
    return logger


class _ObservabilityHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        elif self.path == "/metrics":
            self.send_response(200)
            self.send_header("Content-Type", CONTENT_TYPE_LATEST)
            self.end_headers()
            self.wfile.write(generate_latest())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        return


def start_observability_server(port: int = 8000) -> HTTPServer:
    server = HTTPServer(("0.0.0.0", port), _ObservabilityHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
