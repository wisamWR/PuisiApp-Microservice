import json
import os
from pathlib import Path
from typing import Any, Dict, Optional
from jsonschema import Draft202012Validator
from .galat import GalatPermanen

_VALIDATOR: Optional[Draft202012Validator] = None
_PETA_ROUTING: Optional[Dict[str, str]] = None


def folder_kontrak() -> Path:
    env_dir = os.getenv("CONTRACTS_DIR")
    if env_dir:
        return Path(env_dir)
    default_repo_contracts = Path(__file__).resolve().parents[3] / "contracts"
    if default_repo_contracts.is_dir():
        return default_repo_contracts
    return Path("/contracts")


def _baca_json(nama_berkas: str) -> Dict[str, Any]:
    path = folder_kontrak() / nama_berkas
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _ambil_validator() -> Draft202012Validator:
    global _VALIDATOR
    if _VALIDATOR is None:
        skema = _baca_json("envelope.v1.json")
        _VALIDATOR = Draft202012Validator(
            skema, format_checker=Draft202012Validator.FORMAT_CHECKER
        )
    return _VALIDATOR


def validasi_event(event: Any) -> Dict[str, Any]:
    if not isinstance(event, dict):
        raise GalatPermanen("Amplop event tidak valid: harus berupa objek JSON")
    validator = _ambil_validator()
    errors = sorted(validator.iter_errors(event), key=lambda e: list(e.path))
    if errors:
        rincian = "; ".join(
            f"{'/'.join(str(p) for p in e.path) or '(akar)'} {e.message}" for e in errors
        )
        raise GalatPermanen(f"Amplop event tidak valid: {rincian}")
    return event


def ambil_peta_routing() -> Dict[str, str]:
    global _PETA_ROUTING
    if _PETA_ROUTING is None:
        data = _baca_json("routing.json")
        exchanges = data.get("exchanges", {})
        peta: Dict[str, str] = {}
        for exchange, daftar_event in exchanges.items():
            for event_type in daftar_event:
                if event_type in peta:
                    raise ValueError(f"routing.json: {event_type} terdaftar di dua exchange")
                peta[event_type] = exchange
        _PETA_ROUTING = peta
    return _PETA_ROUTING


def exchange_untuk(event_type: str) -> str:
    exchange = ambil_peta_routing().get(event_type)
    if not exchange:
        raise GalatPermanen(f"Event {event_type} tidak terdaftar di contracts/routing.json")
    return exchange


def _reset_cache_kontrak() -> None:
    global _VALIDATOR, _PETA_ROUTING
    _VALIDATOR = None
    _PETA_ROUTING = None
