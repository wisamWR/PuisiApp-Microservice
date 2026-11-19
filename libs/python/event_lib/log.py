from datetime import datetime, timezone
import json
import logging
import os
from typing import Optional

_LEVEL_NODE = {
    "DEBUG": "debug",
    "INFO": "info",
    "WARNING": "warn",
    "ERROR": "error",
    "CRITICAL": "error",
}


def trace_id_dari(traceparent: Optional[str]) -> Optional[str]:
    if not isinstance(traceparent, str):
        return None
    bagian = traceparent.split("-")
    return bagian[1] if len(bagian) == 4 else None


class JsonFormatter(logging.Formatter):
    def __init__(self, service_name: str):
        super().__init__()
        self.service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        log_obj = {
            "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "level": _LEVEL_NODE.get(record.levelname, "info"),
            "service": self.service_name,
            "msg": record.getMessage(),
        }
        for key in ("correlation_id", "event_id", "trace_id", "event_type", "aggregate_id"):
            val = getattr(record, key, None)
            if val is not None:
                log_obj[key] = val
        if record.exc_info:
            log_obj["err"] = self.formatException(record.exc_info)
        return json.dumps(log_obj, ensure_ascii=False)


def buat_logger(service: Optional[str] = None) -> logging.Logger:
    nama = service or os.getenv("SERVICE_NAME", "tanpa-nama")
    logger = logging.getLogger(nama)
    level_str = os.getenv("LOG_LEVEL", "INFO").upper()
    logger.setLevel(getattr(logging, level_str, logging.INFO))
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter(nama))
        logger.addHandler(handler)
    logger.propagate = False
    return logger
