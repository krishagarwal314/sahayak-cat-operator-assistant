"""Fine-tune the intent classifier - resumable, built for Colab.

    python -m app.ai.intent.build_dataset
    python -m app.ai.intent.train --out /content/intent-run

  * checkpoints to --out every few minutes and at every epoch end; run the
    same command again and it resumes from the exact batch where it stopped
  * keeps the best model (by validation accuracy) in --out/best
  * shows one progress bar for the whole run
  * finishes by writing --out/intent-classifier.zip - the model in half
    precision, about half the size, ready to download and unzip into
    backend/models/intent-classifier on the server
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import time
from collections import Counter
from pathlib import Path

from ...config import BACKEND_DIR, settings
from .taxonomy import LABELS


def _log(msg: str) -> None:
    print(msg, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune the CAT Saathi intent classifier")
    parser.add_argument("--dataset", default=str(BACKEND_DIR / "data" / "intent_dataset.json"))
    parser.add_argument("--base-model", default=settings.intent_base_model)
    parser.add_argument("--out", default=str(BACKEND_DIR / "models" / "intent-run"),
                        help="where checkpoints and the best model go - put this on Google Drive in Colab")
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=4e-5)
    parser.add_argument("--max-length", type=int, default=48)
    parser.add_argument("--warmup-ratio", type=float, default=0.1)
    parser.add_argument("--save-every-minutes", type=float, default=5.0)
    parser.add_argument("--focus-weight", type=float, default=1.5,
                        help="extra loss weight for the focus intents")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--fresh", action="store_true", help="ignore any checkpoint and start over")
    args = parser.parse_args()

    import torch
    from tqdm.auto import tqdm
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

    out = Path(args.out)
    last_dir, best_dir = out / "last", out / "best"
    out.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ data
    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        raise SystemExit(f"No dataset at {dataset_path}. Run: python -m app.ai.intent.build_dataset")
    blob = json.loads(dataset_path.read_text(encoding="utf-8"))
    train_rows, val_rows = blob["train"], blob["validation"]
    meta = blob.get("meta", {})
    focus = set(meta.get("focus", []))
    fingerprint = meta.get("fingerprint", "unknown")

    label2id = {name: i for i, name in enumerate(LABELS)}
    id2label = {i: name for name, i in label2id.items()}
    unknown_labels = {r["label"] for r in train_rows + val_rows} - set(label2id)
    if unknown_labels:
        raise SystemExit(f"Dataset has labels the taxonomy does not know: {sorted(unknown_labels)}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    steps_per_epoch = math.ceil(len(train_rows) / args.batch_size)
    total_steps = steps_per_epoch * args.epochs

    # ------------------------------------------------------------------ resume?
    state = None
    if not args.fresh and (last_dir / "trainer_state.json").exists():
        state = json.loads((last_dir / "trainer_state.json").read_text())
        if state.get("fingerprint") != fingerprint or state.get("base_model") != args.base_model:
            _log("! checkpoint was made with a different dataset or base model - starting fresh")
            state = None

    source = str(last_dir) if state else args.base_model
    tokenizer = AutoTokenizer.from_pretrained(source)
    model = AutoModelForSequenceClassification.from_pretrained(
        source, num_labels=len(LABELS), id2label=id2label, label2id=label2id,
    ).to(device)

    # Inverse frequency weights, softened, with a boost for the focus intents.
    counts = Counter(r["label"] for r in train_rows)
    weights = []
    for name in LABELS:
        w = math.sqrt(len(train_rows) / (len(LABELS) * max(1, counts.get(name, 0))))
        weights.append(w * (args.focus_weight if name in focus else 1.0))
    loss_fn = torch.nn.CrossEntropyLoss(weight=torch.tensor(weights, dtype=torch.float32, device=device))

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    scheduler = get_linear_schedule_with_warmup(optimizer, int(total_steps * args.warmup_ratio), total_steps)

    global_step, best_acc, history = 0, 0.0, []
    if state:
        optimizer.load_state_dict(torch.load(last_dir / "optimizer.pt", map_location=device))
        scheduler.load_state_dict(torch.load(last_dir / "scheduler.pt", map_location=device))
        global_step, best_acc, history = state["global_step"], state["best_acc"], state["history"]
        _log(f"> resuming from step {global_step}/{total_steps} ({global_step / total_steps:.0%}), "
             f"best validation accuracy so far {best_acc:.1%}")
    else:
        _log(f"> starting fresh from {args.base_model}")

    _log(f"  device {device} | {len(train_rows)} train / {len(val_rows)} validation | "
         f"{len(LABELS)} labels | focus: {', '.join(sorted(focus)) or 'none'}")

    # ------------------------------------------------------------------ helpers
    def batches_for(epoch: int):
        # Same order every time for a given epoch, so a resumed run can skip
        # exactly the batches it already did.
        order = torch.randperm(len(train_rows), generator=torch.Generator().manual_seed(args.seed + epoch)).tolist()
        for start in range(0, len(order), args.batch_size):
            yield [train_rows[i] for i in order[start:start + args.batch_size]]

    def encode(rows):
        enc = tokenizer([r["text"] for r in rows], padding=True, truncation=True,
                        max_length=args.max_length, return_tensors="pt")
        enc = {k: v.to(device) for k, v in enc.items()}
        labels = torch.tensor([label2id[r["label"]] for r in rows], dtype=torch.long, device=device)
        return enc, labels

    def evaluate():
        model.eval()
        hits, per = 0, {}
        with torch.inference_mode():
            for start in range(0, len(val_rows), 64):
                rows = val_rows[start:start + 64]
                enc, labels = encode(rows)
                preds = model(**enc).logits.argmax(-1)
                for row, p, g in zip(rows, preds.tolist(), labels.tolist()):
                    ok = p == g
                    hits += ok
                    per.setdefault(row["label"], [0, 0])
                    per[row["label"]][0] += ok
                    per[row["label"]][1] += 1
        model.train()
        acc = hits / max(1, len(val_rows))
        focus_rows = [v for k, v in per.items() if k in focus]
        focus_acc = sum(h for h, _ in focus_rows) / max(1, sum(n for _, n in focus_rows))
        return acc, focus_acc, {k: round(h / n, 3) for k, (h, n) in sorted(per.items())}

    def save_checkpoint(epoch: int, reason: str):
        tmp = out / "last.tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        model.save_pretrained(tmp)
        tokenizer.save_pretrained(tmp)
        torch.save(optimizer.state_dict(), tmp / "optimizer.pt")
        torch.save(scheduler.state_dict(), tmp / "scheduler.pt")
        (tmp / "trainer_state.json").write_text(json.dumps({
            "global_step": global_step, "epoch": epoch, "total_steps": total_steps, "best_acc": best_acc,
            "history": history, "fingerprint": fingerprint, "base_model": args.base_model,
            "saved_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }, indent=1))
        # Swap in atomically: a disconnect mid-save never corrupts the last good checkpoint.
        shutil.rmtree(last_dir, ignore_errors=True)
        tmp.rename(last_dir)
        bar.write(f"  [saved] step {global_step}/{total_steps} ({global_step / total_steps:.0%}) - {reason}")

    def save_best(acc: float, focus_acc: float, per: dict, epoch: int):
        shutil.rmtree(best_dir, ignore_errors=True)
        model.save_pretrained(best_dir)
        tokenizer.save_pretrained(best_dir)
        (best_dir / "labels.json").write_text(json.dumps({str(i): n for i, n in id2label.items()}, indent=1))
        (best_dir / "metrics.json").write_text(json.dumps({
            "base_model": args.base_model, "best_val_accuracy": acc, "focus_val_accuracy": focus_acc,
            "epoch": epoch, "step": global_step, "labels": len(LABELS), "focus": sorted(focus),
            "train_rows": len(train_rows), "val_rows": len(val_rows), "dataset": fingerprint,
            "per_label_accuracy": per, "normalized_input": True,
        }, ensure_ascii=False, indent=1))

    # ------------------------------------------------------------------ train
    model.train()
    bar = tqdm(total=total_steps, initial=global_step, desc="training", unit="step", dynamic_ncols=True)
    last_save = time.time()
    start_epoch = global_step // steps_per_epoch

    for epoch in range(start_epoch, args.epochs):
        skip = global_step - epoch * steps_per_epoch      # batches already done in this epoch
        running, seen = 0.0, 0
        for index, rows in enumerate(batches_for(epoch)):
            if index < skip:
                continue
            enc, labels = encode(rows)
            loss = loss_fn(model(**enc).logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step(); scheduler.step(); optimizer.zero_grad(set_to_none=True)

            global_step += 1
            running += loss.item(); seen += 1
            bar.update(1)
            bar.set_postfix(epoch=f"{epoch + 1}/{args.epochs}", loss=f"{running / seen:.3f}",
                            best=f"{best_acc:.1%}", lr=f"{scheduler.get_last_lr()[0]:.1e}")

            if time.time() - last_save > args.save_every_minutes * 60:
                save_checkpoint(epoch, "timed save")
                last_save = time.time()

        acc, focus_acc, per = evaluate()
        history.append({"epoch": epoch + 1, "step": global_step, "loss": round(running / max(1, seen), 4),
                        "val_accuracy": round(acc, 4), "focus_accuracy": round(focus_acc, 4)})
        improved = acc >= best_acc
        if improved:
            best_acc = acc
            save_best(acc, focus_acc, per, epoch + 1)
        bar.write(f"epoch {epoch + 1}/{args.epochs}: loss {running / max(1, seen):.3f} | "
                  f"validation {acc:.1%} | focus intents {focus_acc:.1%}" + ("  <- best, saved" if improved else ""))
        save_checkpoint(epoch + 1, f"end of epoch {epoch + 1}")
        last_save = time.time()

    bar.close()

    # ------------------------------------------------------------------ report
    metrics = json.loads((best_dir / "metrics.json").read_text())
    _log(f"\ndone. best validation {metrics['best_val_accuracy']:.1%}, "
         f"focus intents {metrics['focus_val_accuracy']:.1%} (epoch {metrics['epoch']})")
    _log("focus intents:")
    for name in sorted(focus):
        _log(f"  {name:20s} {metrics['per_label_accuracy'].get(name, 0):.0%}")
    weakest = sorted(metrics["per_label_accuracy"].items(), key=lambda kv: kv[1])[:5]
    _log("weakest labels: " + ", ".join(f"{k} {v:.0%}" for k, v in weakest))
    _log(f"\nmodel ready at {best_dir}")

    # Half precision halves the download; the server loads it back as float32.
    export = out / "export"
    shutil.rmtree(export, ignore_errors=True)
    final = AutoModelForSequenceClassification.from_pretrained(best_dir).half()
    final.save_pretrained(export)
    AutoTokenizer.from_pretrained(best_dir).save_pretrained(export)
    for name in ("labels.json", "metrics.json"):
        shutil.copy(best_dir / name, export / name)
    archive = shutil.make_archive(str(out / "intent-classifier"), "zip", root_dir=export)
    size_mb = Path(archive).stat().st_size / 1e6
    _log(f"download this file: {archive}  ({size_mb:.0f} MB)")
    _log("then on the server:  unzip -o intent-classifier.zip -d backend/models/intent-classifier")


if __name__ == "__main__":
    main()
