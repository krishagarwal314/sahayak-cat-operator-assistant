"""Fine-tune the intent classifier.

    python -m app.ai.intent.build_dataset          # writes data/intent_dataset.json
    python -m app.ai.intent.train                  # writes models/intent-classifier/

Deliberately a plain PyTorch loop rather than Trainer: this is the one model the
project owns, it is small enough to train in a couple of minutes on a GPU (or
~15 minutes on CPU), and a visible loop is easier to explain and to tune than a
framework callback chain.

Class weights are applied because the taxonomy is naturally imbalanced - the
UNKNOWN bucket and the big intents carry many more phrases than a narrow sensor
intent like UNDERCARRIAGE_WEAR.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from collections import Counter
from pathlib import Path

from ...config import BACKEND_DIR, settings
from .taxonomy import LABELS


def _load_dataset(path: Path) -> tuple[list[dict], list[dict]]:
    if not path.exists():
        raise SystemExit(
            f"dataset not found at {path}\nRun: python -m app.ai.intent.build_dataset --out {path}"
        )
    blob = json.loads(path.read_text(encoding="utf-8"))
    return blob["train"], blob["validation"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune the operator intent classifier")
    parser.add_argument("--dataset", default=str(BACKEND_DIR / "data" / "intent_dataset.json"))
    parser.add_argument("--base-model", default=settings.intent_base_model)
    parser.add_argument("--out", default=str(settings.intent_model_dir))
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=3e-5)
    parser.add_argument("--max-length", type=int, default=64)
    parser.add_argument("--warmup-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    import numpy as np
    import torch
    from torch.utils.data import DataLoader, Dataset
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    train_rows, val_rows = _load_dataset(Path(args.dataset))
    label2id = {name: i for i, name in enumerate(LABELS)}
    id2label = {i: name for name, i in label2id.items()}

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"base model : {args.base_model}")
    print(f"device     : {device}")
    print(f"data       : {len(train_rows)} train / {len(val_rows)} val / {len(LABELS)} labels")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base_model, num_labels=len(LABELS), id2label=id2label, label2id=label2id
    ).to(device)

    class IntentDataset(Dataset):
        def __init__(self, rows: list[dict]) -> None:
            self.rows = rows

        def __len__(self) -> int:
            return len(self.rows)

        def __getitem__(self, idx: int) -> dict:
            return self.rows[idx]

    def collate(batch: list[dict]) -> dict:
        enc = tokenizer(
            [b["text"] for b in batch],
            padding=True,
            truncation=True,
            max_length=args.max_length,
            return_tensors="pt",
        )
        enc["labels"] = torch.tensor([label2id[b["label"]] for b in batch], dtype=torch.long)
        return enc

    train_loader = DataLoader(IntentDataset(train_rows), batch_size=args.batch_size, shuffle=True, collate_fn=collate)
    val_loader = DataLoader(IntentDataset(val_rows), batch_size=args.batch_size, collate_fn=collate)

    # Inverse-frequency class weights, softened by a square root so the rare
    # classes are helped without swamping the loss.
    counts = Counter(row["label"] for row in train_rows)
    weights = torch.tensor(
        [math.sqrt(len(train_rows) / (len(LABELS) * max(1, counts.get(name, 0)))) for name in LABELS],
        dtype=torch.float32,
    ).to(device)
    loss_fn = torch.nn.CrossEntropyLoss(weight=weights)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    total_steps = len(train_loader) * args.epochs
    scheduler = get_linear_schedule_with_warmup(
        optimizer, int(total_steps * args.warmup_ratio), total_steps
    )

    def evaluate() -> tuple[float, dict[str, float]]:
        model.eval()
        correct = total = 0
        per_label_correct: Counter = Counter()
        per_label_total: Counter = Counter()
        with torch.inference_mode():
            for batch in val_loader:
                labels = batch.pop("labels").to(device)
                batch = {k: v.to(device) for k, v in batch.items()}
                preds = model(**batch).logits.argmax(dim=-1)
                correct += int((preds == labels).sum())
                total += int(labels.numel())
                for pred, gold in zip(preds.tolist(), labels.tolist()):
                    per_label_total[id2label[gold]] += 1
                    if pred == gold:
                        per_label_correct[id2label[gold]] += 1
        per_label = {
            name: per_label_correct[name] / per_label_total[name]
            for name in sorted(per_label_total)
            if per_label_total[name]
        }
        return (correct / max(1, total)), per_label

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    best_acc = 0.0
    history: list[dict] = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        started = time.perf_counter()
        running = 0.0
        for step, batch in enumerate(train_loader, start=1):
            labels = batch.pop("labels").to(device)
            batch = {k: v.to(device) for k, v in batch.items()}
            logits = model(**batch).logits
            loss = loss_fn(logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad(set_to_none=True)
            running += float(loss)
            if step % 20 == 0:
                print(f"  epoch {epoch} step {step}/{len(train_loader)} loss {running / step:.4f}", flush=True)

        acc, per_label = evaluate()
        elapsed = time.perf_counter() - started
        history.append({"epoch": epoch, "loss": running / len(train_loader), "val_accuracy": acc, "seconds": elapsed})
        print(f"epoch {epoch}: loss {running / len(train_loader):.4f}  val_acc {acc:.4f}  ({elapsed:.0f}s)")

        if acc >= best_acc:
            best_acc = acc
            model.save_pretrained(out_dir)
            tokenizer.save_pretrained(out_dir)
            (out_dir / "labels.json").write_text(
                json.dumps({str(i): name for i, name in id2label.items()}, ensure_ascii=False, indent=1),
                encoding="utf-8",
            )
            weak = {k: round(v, 3) for k, v in sorted(per_label.items(), key=lambda x: x[1])[:8]}
            (out_dir / "metrics.json").write_text(
                json.dumps(
                    {
                        "base_model": args.base_model,
                        "best_val_accuracy": acc,
                        "epochs_run": epoch,
                        "labels": len(LABELS),
                        "train_rows": len(train_rows),
                        "val_rows": len(val_rows),
                        "weakest_labels": weak,
                        "per_label_accuracy": {k: round(v, 3) for k, v in per_label.items()},
                        "history": history,
                    },
                    ensure_ascii=False,
                    indent=1,
                ),
                encoding="utf-8",
            )
            print(f"  saved checkpoint (val_acc {acc:.4f}) -> {out_dir}")

    print(f"\ndone. best validation accuracy {best_acc:.4f}")
    print(f"the API picks this up automatically from {out_dir}")


if __name__ == "__main__":
    main()
