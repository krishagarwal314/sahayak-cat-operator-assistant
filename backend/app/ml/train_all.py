"""Train the three small models: task time, safety risk and unusual use.

    python -m app.ml.train_all

Both train in a few seconds on any CPU - no GPU needed. The server loads them
automatically from backend/models/ml/.
"""

from __future__ import annotations

from .. import db
from . import safety_risk, task_time, unusual_use


def main() -> None:
    print("task time model ...")
    t = task_time.train(db.TASK_HISTORY)
    print(f"  trained on {t['trained_on_jobs']} past jobs, tested on {t['test_jobs']} it never saw")
    print(f"  average error {t['mae_minutes']} min ({t['mape_pct']}%) vs {t['baseline_mae_minutes']} min for the "
          f"simple baseline -> {t['improvement_vs_baseline_pct']}% better")
    print(f"  the predicted range contains the real time {t['range_coverage_pct']}% of the time (target 80%)")

    print("safety risk model ...")
    s = safety_risk.train()
    print(f"  trained on {s['train_hours']} hours, tested on {s['test_hours']} hours from {s['test_days']} unseen days")
    print(f"  AUC {s['auc']} vs {s['baseline_auc']} for 'alert now means alert next hour' (0.5 = guessing)")
    print(f"  flags high risk: {s['precision_at_0.4_pct']}% of flagged hours really had an alert, "
          f"catching {s['recall_at_0.4_pct']}% of them (base rate {s['base_rate_pct']}%)")
    print("unusual use model ...")
    u = unusual_use.train()
    print(f"  {u['hours']} hours scored by day-held-out folds, {u['misuse_hours']} planted misuse hours")
    print(f"  AUC {u['auc']} vs {u['baseline_auc']} for per-column thresholds")
    print(f"  flagging {u['flag_rate_pct']:.0f}% of hours: {u['precision_pct']}% of flags are real misuse, "
          f"catching {u['recall_pct']}% (thresholds: {u['baseline_precision_pct']}% / {u['baseline_recall_pct']}%)")
    print("\nsaved to backend/models/ml/")


if __name__ == "__main__":
    main()
