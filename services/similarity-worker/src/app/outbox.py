from psycopg2.extras import Json


def simpan_outbox(cur, event: dict) -> None:
    """Menyimpan event ke Outbox dalam transaksi yang sama.

    Kolom payload berisi AMPLOP UTUH (sama dengan libs/node tulisOutbox):
    outbox-relay meneruskan kolom ini apa adanya sebagai body pesan, dan
    konsumen (publication-service, poem-query-service) memvalidasi amplop.
    Menyimpan event["payload"] saja membuat pesan ditolak ke DLQ.
    """
    cur.execute(
        """
        INSERT INTO outbox (
            event_id,
            aggregate_type,
            aggregate_id,
            event_type,
            payload,
            created_at
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (event_id) DO NOTHING
        """,
        (
            event["event_id"],
            event["event_type"].split(".")[0],
            event["aggregate_id"],
            event["event_type"],
            Json(event),
            event["occurred_at"],
        ),
    )
