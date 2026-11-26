import json
import os
import time
import urllib.request
from base64 import b64encode
from prometheus_client import Gauge, start_http_server

RABBIT_URL = os.getenv("RABBIT_URL", "http://rabbitmq:15672").rstrip("/")
RABBIT_USER = os.getenv("RABBIT_USER", "guest")
RABBIT_PASS = os.getenv("RABBIT_PASS", "guest")
PORT = int(os.getenv("PUBLISH_PORT", "9419"))
INTERVAL = int(os.getenv("SCRAPE_INTERVAL", "10"))

g_messages = Gauge("rabbitmq_queue_messages", "Total messages in queue", ["vhost", "queue"])
g_ready = Gauge("rabbitmq_queue_messages_ready", "Ready messages in queue", ["vhost", "queue"])
g_consumers = Gauge("rabbitmq_queue_consumers", "Active consumers on queue", ["vhost", "queue"])
g_age = Gauge("rabbitmq_queue_message_age_seconds", "Age of oldest message in seconds", ["vhost", "queue"])


def fetch_json(path: str):
    token = b64encode(f"{RABBIT_USER}:{RABBIT_PASS}".encode()).decode()
    req = urllib.request.Request(
        f"{RABBIT_URL}{path}",
        headers={"Authorization": f"Basic {token}"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode())


def collect_once():
    queues = fetch_json("/api/queues")
    now_ms = time.time() * 1000.0
    for q in queues:
        vhost = q.get("vhost", "/")
        name = q.get("name", "")
        g_messages.labels(vhost=vhost, queue=name).set(float(q.get("messages", 0) or 0))
        g_ready.labels(vhost=vhost, queue=name).set(float(q.get("messages_ready", 0) or 0))
        g_consumers.labels(vhost=vhost, queue=name).set(float(q.get("consumers", 0) or 0))
        head_ts = q.get("head_message_timestamp")
        age_s = max(0.0, (now_ms - float(head_ts)) / 1000.0) if head_ts else 0.0
        g_age.labels(vhost=vhost, queue=name).set(age_s)


if __name__ == "__main__":
    start_http_server(PORT)
    while True:
        try:
            collect_once()
        except Exception as exc:
            print(f"[rabbitmq-exporter] error: {exc}", flush=True)
        time.sleep(INTERVAL)
