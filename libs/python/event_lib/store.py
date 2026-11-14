from typing import Any, Callable, Dict, Optional


class StorePg:
    """Store idempoten PostgreSQL sesuai libs/node/src/store.js."""

    def __init__(self, pg_conn, kunci_agregat: bool = True):
        self.pg_conn = pg_conn
        self.kunci_agregat = kunci_agregat

    def proses(
        self,
        event: Dict[str, Any],
        handler: Callable[[Dict[str, Any], Any], None],
        versi_tersimpan: Optional[Callable[[Dict[str, Any], Any], Optional[int]]] = None,
    ) -> str:
        with self.pg_conn:
            with self.pg_conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO processed_event (event_id) VALUES (%s) ON CONFLICT (event_id) DO NOTHING",
                    (event["event_id"],),
                )
                if cur.rowcount == 0:
                    return "duplikat"

                if self.kunci_agregat:
                    cur.execute(
                        "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                        (str(event["aggregate_id"]),),
                    )

                if versi_tersimpan is not None:
                    tersimpan = versi_tersimpan(event, cur)
                    if tersimpan is not None and tersimpan > int(event["aggregate_version"]):
                        return "basi"

                handler(event, cur)
                return "diproses"


class StoreTanpaDb:
    def proses(
        self,
        event: Dict[str, Any],
        handler: Callable[[Dict[str, Any], Any], None],
        versi_tersimpan: Optional[Callable[[Dict[str, Any], Any], Optional[int]]] = None,
    ) -> str:
        handler(event, None)
        return "diproses"
