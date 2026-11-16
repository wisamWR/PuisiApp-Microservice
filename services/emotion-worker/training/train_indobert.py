"""Fine-tune IndoBERT (indobenchmark/indobert-base-p1) pada dataset IndoNLU EmoT (5 emosi)."""
import argparse
import csv
import urllib.request
from pathlib import Path

LABEL_MAP = {"anger": 0, "fear": 1, "happy": 2, "love": 3, "sadness": 4}
ID2LABEL = {0: "marah", 1: "takut", 2: "senang", 3: "cinta", 4: "sedih"}
LABEL2ID = {v: k for k, v in ID2LABEL.items()}
BASE_URL = "https://raw.githubusercontent.com/IndoNLP/indonlu/master/dataset/emot_emotion-twitter"


def unduh_split(cache_dir: Path, split: str) -> list[tuple[str, int]]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"{split}_preprocess.csv"
    if not target.exists():
        urllib.request.urlretrieve(f"{BASE_URL}/{split}_preprocess.csv", target)
    data = []
    with target.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            lbl = row["label"].strip().lower()
            if lbl in LABEL_MAP:
                data.append((row["tweet"].strip(), LABEL_MAP[lbl]))
    return data


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default="indobenchmark/indobert-base-p1")
    parser.add_argument(
        "--output-dir",
        default=str(Path.home() / ".cache/puisiapp/indobert-emot"),
    )
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    args = parser.parse_args()

    import torch
    from torch.utils.data import DataLoader, Dataset
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    cache_ds = Path.home() / ".cache/puisiapp/indonlu-emot"
    train_rows = unduh_split(cache_ds, "train")
    valid_rows = unduh_split(cache_ds, "valid")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base_model, num_labels=5, id2label=ID2LABEL, label2id=LABEL2ID
    )

    class EmoDataset(Dataset):
        def __init__(self, rows):
            self.rows = rows

        def __len__(self):
            return len(self.rows)

        def __getitem__(self, idx):
            teks, y = self.rows[idx]
            enc = tokenizer(
                teks, truncation=True, max_length=128, padding="max_length", return_tensors="pt"
            )
            return {k: v.squeeze(0) for k, v in enc.items()}, torch.tensor(y, dtype=torch.long)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    loader = DataLoader(EmoDataset(train_rows), batch_size=args.batch_size, shuffle=True)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr)

    for ep in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        for batch_x, batch_y in loader:
            batch_x = {k: v.to(device) for k, v in batch_x.items()}
            batch_y = batch_y.to(device)
            opt.zero_grad()
            out = model(**batch_x, labels=batch_y)
            out.loss.backward()
            opt.step()
            total_loss += out.loss.item()
        avg_loss = total_loss / len(loader)
        print(f"Epoch {ep}/{args.epochs} - loss: {avg_loss:.4f} (valid samples: {len(valid_rows)})")

    out_path = Path(args.output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(out_path)
    tokenizer.save_pretrained(out_path)
    print(f"Model tersimpan di luar repo: {out_path}")


if __name__ == "__main__":
    main()
