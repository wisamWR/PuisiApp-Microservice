import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import urlopen

from app.main import HealthHandler


def test_health_endpoint():
    server = ThreadingHTTPServer(("127.0.0.1", 0), HealthHandler)
    thread = threading.Thread(target=server.serve_forever)

    try:
        thread.start()

        with urlopen(f"http://127.0.0.1:{server.server_port}/health") as response:
            payload = json.loads(response.read())

            assert response.status == 200
            assert payload["status"] == "ok"
            assert payload["service"] == "python-service"

    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def test_unknown_endpoint_returns_404():
    server = ThreadingHTTPServer(("127.0.0.1", 0), HealthHandler)
    thread = threading.Thread(target=server.serve_forever)

    try:
        thread.start()

        try:
            urlopen(f"http://127.0.0.1:{server.server_port}/unknown")
            assert False, "Endpoint seharusnya mengembalikan HTTP 404"
        except HTTPError as error:
            assert error.code == 404

    finally:
        server.shutdown()
        thread.join()
        server.server_close()
