from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError


class StoreMongoEmosi:
    def __init__(self, db):
        self.db = db
        self.processed = db["processed_events"]
        self.emotions = db["poem_emotions"]
        self.processed.create_index([("event_id", ASCENDING)], unique=True)
        self.emotions.create_index([("poem_id", ASCENDING), ("version", DESCENDING)], unique=True)

    def versi_terakhir(self, poem_id: str) -> int | None:
        dok = self.emotions.find_one(
            {"poem_id": poem_id},
            projection={"version": 1},
            sort=[("version", DESCENDING)],
        )
        return int(dok["version"]) if dok and "version" in dok else None

    def proses(
        self,
        event: dict[str, Any],
        handler: Callable[[dict[str, Any], Any], None],
        versi_tersimpan: Callable[[dict[str, Any], Any], int | None] | None = None,
    ) -> str:
        event_id = event["event_id"]
        if self.processed.find_one({"event_id": event_id}, projection={"_id": 1}):
            return "duplikat"

        if versi_tersimpan is not None:
            versi_lama = versi_tersimpan(event, self.db)
            if versi_lama is not None and versi_lama > event["aggregate_version"]:
                self._catat_event(event_id)
                return "basi"

        handler(event, self.db)
        self._catat_event(event_id)
        return "diproses"

    def simpan_hasil(self, dokumen: dict[str, Any]) -> None:
        self.emotions.update_one(
            {"poem_id": dokumen["poem_id"], "version": dokumen["version"]},
            {"$set": dokumen},
            upsert=True,
        )

    def _catat_event(self, event_id: str) -> None:
        try:
            self.processed.insert_one(
                {
                    "event_id": event_id,
                    "processed_at": datetime.now(UTC).isoformat(),
                }
            )
        except DuplicateKeyError:
            pass
