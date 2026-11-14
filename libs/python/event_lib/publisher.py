import json
import os
from pathlib import Path
from typing import Any, Dict, Optional
import pika


def resolve_exchange(
    event_type: str,
    routing_path: Optional[str] = None,
    fallback_exchange: Optional[str] = None,
) -> str:
    candidates = [
        routing_path,
        os.getenv("ROUTING_CONFIG_PATH"),
        "/contracts/routing.json",
        "contracts/routing.json",
    ]
    for path_str in candidates:
        if path_str and Path(path_str).is_file():
            with open(path_str, "r", encoding="utf-8") as f:
                routing_map = json.load(f)
            if event_type in routing_map:
                return routing_map[event_type]

    if fallback_exchange:
        return fallback_exchange
    raise ValueError(f"Exchange untuk event_type '{event_type}' tidak ditemukan di routing.json")


def publish_event(
    channel: pika.adapters.blocking_connection.BlockingChannel,
    envelope: Dict[str, Any],
    exchange: Optional[str] = None,
    routing_path: Optional[str] = None,
) -> None:
    routing_key = envelope["event_type"]
    target_exchange = resolve_exchange(routing_key, routing_path, exchange)

    channel.exchange_declare(exchange=target_exchange, exchange_type="topic", durable=True)
    channel.basic_publish(
        exchange=target_exchange,
        routing_key=routing_key,
        body=json.dumps(envelope),
        properties=pika.BasicProperties(
            delivery_mode=2,
            content_type="application/json",
            message_id=envelope["event_id"],
            correlation_id=envelope["correlation_id"],
        ),
    )
