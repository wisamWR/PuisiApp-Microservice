"""Membuat event_lib (libs/python) dan contracts/ terbaca saat pytest.

CI memasang layanan dengan `pip install -e ".[dev]"` tanpa libs/python,
sedangkan image Docker memakai PYTHONPATH. Di sini path dipasang manual.
"""

import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT_DIR / "libs" / "python"))
os.environ.setdefault("CONTRACTS_DIR", str(ROOT_DIR / "contracts"))
