import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = str(SERVICE_ROOT / "src")

sys.path[:] = [
    p for p in sys.path
    if "fingerprint-worker" not in p and "similarity-worker" not in p
]
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

existing_app = sys.modules.get("app")
if existing_app is not None:
    app_file = getattr(existing_app, "__file__", "") or ""
    if not str(Path(app_file).resolve()).startswith(str((SERVICE_ROOT / "src" / "app").resolve())):
        for mod_name in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[mod_name]
