
from psycopg2.extras import Json


def simpan_outbox(cur, event: dict) -> None:
    """Menyimpan event ke Outbox dalam transaksi yang sama."""
    cur.execute(
        """
        INSERT INTO outbox (
            event_id,
            aggregate_type,
            aggregate_id,
            event_type,
            payload
        )
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (event_id) DO NOTHING
        """,
        (
            event["event_id"],
            "poem",
            event["aggregate_id"],
            event["event_type"],
            Json(event["payload"]),
        ),
    )
