import json
import random
from typing import Any, Callable, Dict, List, Optional, Tuple
import pika

RETRY_DELAYS_MS = [2000, 8000, 32000]


def _extract_trace_id(traceparent: Optional[str]) -> str:
    if not traceparent:
        return ""
    parts = traceparent.split("-")
    return parts[1] if len(parts) >= 2 else ""


def setup_topology(
    channel: pika.adapters.blocking_connection.BlockingChannel,
    service_name: str,
    bindings: List[Tuple[str, str]],
) -> str:
    queue_name = f"q.{service_name}"
    dlq_name = f"q.{service_name}.dlq"

    channel.exchange_declare(
        exchange="retry.delayed",
        exchange_type="x-delayed-message",
        durable=True,
        arguments={"x-delayed-type": "direct"},
    )

    channel.queue_declare(queue=dlq_name, durable=True)
    channel.queue_declare(
        queue=queue_name,
        durable=True,
        arguments={
            "x-queue-type": "quorum",
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": dlq_name,
        },
    )
    channel.queue_bind(queue=queue_name, exchange="retry.delayed", routing_key=queue_name)

    for exchange, routing_key in bindings:
        channel.exchange_declare(exchange=exchange, exchange_type="topic", durable=True)
        channel.queue_bind(queue=queue_name, exchange=exchange, routing_key=routing_key)

    return queue_name


def process_message_with_idempotency(
    pg_conn,
    event: Dict[str, Any],
    handler: Callable[[Dict[str, Any], Any], None],
    is_newer_version: Optional[Callable[[Any, str, int], bool]] = None,
) -> str:
    event_id = event["event_id"]
    agg_id = str(event["aggregate_id"])
    agg_ver = int(event.get("aggregate_version", 1))

    with pg_conn:
        with pg_conn.cursor() as cur:
            # 1. Cek idempotensi di tabel standar processed_event(event_id, processed_at)
            cur.execute("SELECT 1 FROM processed_event WHERE event_id = %s", (event_id,))
            if cur.fetchone():
                return "duplicate"

            # 2. Abaikan jika aggregate_version lebih lama (diperiksa ke tabel domain)
            if is_newer_version is not None and not is_newer_version(cur, agg_id, agg_ver):
                return "stale"

            # 3. Eksekusi logika bisnis worker
            handler(event, cur)

            # 4. Catat event_id dalam transaksi yang sama
            cur.execute(
                "INSERT INTO processed_event (event_id, processed_at) VALUES (%s, NOW())",
                (event_id,),
            )
    return "processed"


def consume_idempotent(
    channel: pika.adapters.blocking_connection.BlockingChannel,
    queue_name: str,
    pg_conn,
    handler: Callable[[Dict[str, Any], Any], None],
    logger,
    is_newer_version: Optional[Callable[[Any, str, int], bool]] = None,
) -> None:
    def _callback(ch, method, properties, body):
        event = json.loads(body)
        event_id = event.get("event_id", "unknown")
        corr_id = event.get("correlation_id", "")
        trace_id = _extract_trace_id(event.get("traceparent"))
        log_ctx = {"event_id": event_id, "correlation_id": corr_id, "trace_id": trace_id}

        headers = properties.headers or {}
        retry_count = int(headers.get("x-retry-count", 0))

        try:
            status = process_message_with_idempotency(pg_conn, event, handler, is_newer_version)
            logger.info(f"Event selesai dengan status: {status}", extra=log_ctx)
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as exc:
            logger.error(f"Gagal memproses event (percobaan {retry_count + 1}): {exc}", extra=log_ctx)
            if retry_count < len(RETRY_DELAYS_MS):
                delay = random.randint(500, RETRY_DELAYS_MS[retry_count])
                new_headers = {**headers, "x-retry-count": retry_count + 1, "x-delay": delay}
                ch.basic_publish(
                    exchange="retry.delayed",
                    routing_key=queue_name,
                    body=body,
                    properties=pika.BasicProperties(delivery_mode=2, headers=new_headers),
                )
                ch.basic_ack(delivery_tag=method.delivery_tag)
            else:
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue=queue_name, on_message_callback=_callback)
    channel.start_consuming()
