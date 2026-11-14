from datetime import datetime
import json
from typing import Any, Dict, Optional
import pika
from .kontrak import exchange_untuk, validasi_event
from .topologi import pastikan_exchange_domain


def opsi_pesan(
    event: Dict[str, Any], header_tambahan: Optional[Dict[str, Any]] = None
) -> pika.BasicProperties:
    headers: Dict[str, Any] = {"correlation_id": event["correlation_id"]}
    if event.get("traceparent"):
        headers["traceparent"] = event["traceparent"]
    if header_tambahan:
        headers.update(header_tambahan)

    ts = int(datetime.fromisoformat(event["occurred_at"].replace("Z", "+00:00")).timestamp())
    return pika.BasicProperties(
        delivery_mode=2,
        content_type="application/json",
        content_encoding="utf-8",
        message_id=event["event_id"],
        correlation_id=event["correlation_id"],
        type=event["event_type"],
        app_id=event["producer"],
        timestamp=ts,
        headers=headers,
    )


class Publisher:
    def __init__(self, channel: pika.adapters.blocking_connection.BlockingChannel):
        self.channel = channel
        self.channel.confirm_delivery()
        self._exchange_siap: set[str] = set()

    def terbitkan(
        self, event: Dict[str, Any], headers: Optional[Dict[str, Any]] = None
    ) -> None:
        validasi_event(event)
        exchange = exchange_untuk(event["event_type"])
        if exchange not in self._exchange_siap:
            pastikan_exchange_domain(self.channel, exchange)
            self._exchange_siap.add(exchange)

        body = json.dumps(event, ensure_ascii=False).encode("utf-8")
        self.channel.basic_publish(
            exchange=exchange,
            routing_key=event["event_type"],
            body=body,
            properties=opsi_pesan(event, headers),
        )


def buat_publisher(channel: pika.adapters.blocking_connection.BlockingChannel) -> Publisher:
    return Publisher(channel)
