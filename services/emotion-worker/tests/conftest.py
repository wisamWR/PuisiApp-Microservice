import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
os.environ.setdefault("CONTRACTS_DIR", str(ROOT_DIR / "contracts"))
