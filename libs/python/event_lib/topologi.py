from typing import Iterable, Tuple
import pika
from .kontrak import exchange_untuk

EXCHANGE_DLX = "dlx"
EXCHANGE_RETRY = "retry.delayed"
BATAS_PENGIRIMAN = 5


def pastikan_exchange_domain(
    channel: pika.adapters.blocking_connection.BlockingChannel, exchange: str
) -> None:
    channel.exchange_declare(exchange=exchange, exchange_type="topic", durable=True)


def pastikan_antrean(
    channel: pika.adapters.blocking_connection.BlockingChannel,
    antrean: str,
    ikatan: Iterable[str],
) -> Tuple[str, str]:
    if not antrean.startswith("q."):
        raise ValueError(f'Nama queue harus diawali "q.": {antrean}')
    dlq = f"{antrean}.dlq"

    channel.exchange_declare(exchange=EXCHANGE_DLX, exchange_type="direct", durable=True)
    channel.exchange_declare(
        exchange=EXCHANGE_RETRY,
        exchange_type="x-delayed-message",
        durable=True,
        arguments={"x-delayed-type": "direct"},
    )

    channel.queue_declare(
        queue=dlq,
        durable=True,
        arguments={"x-queue-type": "quorum"},
    )
    channel.queue_bind(queue=dlq, exchange=EXCHANGE_DLX, routing_key=dlq)

    channel.queue_declare(
        queue=antrean,
        durable=True,
        arguments={
            "x-queue-type": "quorum",
            "x-dead-letter-exchange": EXCHANGE_DLX,
            "x-dead-letter-routing-key": dlq,
            "x-delivery-limit": BATAS_PENGIRIMAN,
        },
    )
    channel.queue_bind(queue=antrean, exchange=EXCHANGE_RETRY, routing_key=antrean)

    for event_type in ikatan:
        exchange = exchange_untuk(event_type)
        pastikan_exchange_domain(channel, exchange)
        channel.queue_bind(queue=antrean, exchange=exchange, routing_key=event_type)

    return antrean, dlq
