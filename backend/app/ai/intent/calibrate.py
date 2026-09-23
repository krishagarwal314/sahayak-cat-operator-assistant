"""Calibrate the intent classifier's confidence (temperature scaling).

    python -m app.ai.intent.calibrate

A fine-tuned classifier can rank intents correctly yet spread its probability
too thinly - right answer on top, but at 25%. The router only trusts answers
above a threshold, so an under-confident model is never used at all.

Temperature scaling fixes this without retraining: divide the logits by one
number T, chosen to make the predicted probabilities match how often the
model is actually right on the validation set. It never changes which intent
comes out on top - only how sure the model says it is. T is saved next to the
model in calibration.json and applied automatically.
"""

from __future__ import annotations

import json
import math

from ...config import BACKEND_DIR, settings


def main() -> None:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    model_dir = settings.intent_model_dir
    data = json.loads((BACKEND_DIR / "data" / "intent_dataset.json").read_text(encoding="utf-8"))
    rows = data["validation"]
    labels = {int(k): v for k, v in json.loads((model_dir / "labels.json").read_text()).items()}
    label2id = {v: k for k, v in labels.items()}

    tok = AutoTokenizer.from_pretrained(str(model_dir))
    model = AutoModelForSequenceClassification.from_pretrained(str(model_dir), torch_dtype=torch.float32).eval()

    logits, targets = [], []
    with torch.inference_mode():
        for start in range(0, len(rows), 32):
            batch = rows[start:start + 32]
            enc = tok([r["text"] for r in batch], padding=True, truncation=True, max_length=48, return_tensors="pt")
            logits.append(model(**enc).logits.float())
            targets += [label2id[r["label"]] for r in batch]
    logits = torch.cat(logits)
    y = torch.tensor(targets)

    def nll(t: float) -> float:
        return float(torch.nn.functional.cross_entropy(logits / t, y))

    # One number, one dimension: a simple search is exact enough and cannot diverge.
    grid = [round(0.05 * i, 2) for i in range(1, 61)]            # 0.05 .. 3.0
    best_t = min(grid, key=nll)

    def summary(t: float) -> tuple[float, float, float]:
        p = torch.softmax(logits / t, -1)
        conf, pred = p.max(-1)
        right = pred == y
        return float(right.float().mean()), float(conf[right].mean()), float(conf[~right].mean()) if (~right).any() else 0.0

    acc, c_right, c_wrong = summary(1.0)
    _, c_right_t, c_wrong_t = summary(best_t)
    (model_dir / "calibration.json").write_text(json.dumps({"temperature": best_t, "nll_before": round(nll(1.0), 4),
                                                             "nll_after": round(nll(best_t), 4)}, indent=1))
    print(f"validation accuracy {acc:.1%} (unchanged by calibration)")
    print(f"temperature T = {best_t}   (NLL {nll(1.0):.3f} -> {nll(best_t):.3f})")
    print(f"average confidence when RIGHT: {c_right:.0%} -> {c_right_t:.0%}")
    print(f"average confidence when WRONG: {c_wrong:.0%} -> {c_wrong_t:.0%}")
    print(f"saved to {model_dir / 'calibration.json'}")


if __name__ == "__main__":
    main()
