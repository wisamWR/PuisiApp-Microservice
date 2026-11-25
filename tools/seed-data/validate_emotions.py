import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "emotion-worker" / "src"))

from app.leksikon import muat_kamus, analisis_puisi

kamus = muat_kamus(ROOT / "services" / "emotion-worker" / "data" / "kamus_emosi.json")
puisi = json.loads((ROOT / "tools" / "seed-data" / "poems.json").read_text(encoding="utf-8-sig"))

hasil = []
for item in puisi:
    analisis = analisis_puisi(item["body"], kamus)
    hasil.append({
        "judul": item["title"],
        "target": item["emotion"],
        "terdeteksi": analisis["dominant"],
        "sesuai": item["emotion"] == analisis["dominant"]
    })

for emosi in ("senang", "sedih", "cinta", "marah", "takut"):
    cocok = sum(1 for x in hasil if x["target"] == emosi and x["sesuai"])
    total = sum(1 for x in hasil if x["target"] == emosi)
    print(f"{emosi}: {cocok}/{total} sesuai")

gagal = [x for x in hasil if not x["sesuai"]]
print(f"\nTotal sesuai: {len(hasil) - len(gagal)}/{len(hasil)}")
print(f"Total tidak sesuai: {len(gagal)}")

for item in gagal:
    print(f"- {item['judul']}: target={item['target']}, terdeteksi={item['terdeteksi']}")

if gagal:
    sys.exit(1)
