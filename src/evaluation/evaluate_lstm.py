"""
Final evaluation of the trained GRU model against the baseline.

Loads best GRU checkpoint and logistic regression baseline.
Reports metrics on validation and test sets, per competition.

Saves:
  models/trained/gru_eval_results.json
"""

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import torch
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from src.features.encode_possessions import N_FEATURES, load_split_tensors, MAX_SEQ_LEN
from src.models.dataset import PossessionDataset
from src.models.lstm_model import PossessionGRU

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"
MODELS = ROOT / "models" / "trained"

NUMERIC_FEATURES = [
    "n_events", "n_pass", "n_carry", "n_dribble", "n_pressure",
    "n_attacking_third", "start_x", "end_x", "progression",
    "total_duration", "match_minute_start",
]
CATEGORICAL_FEATURES = ["start_zone", "end_zone", "play_pattern"]


def gru_predict(split: str, device) -> tuple[np.ndarray, np.ndarray, pd.DataFrame]:
    X, lengths, y, df = load_split_tensors(split, MAX_SEQ_LEN)

    model = PossessionGRU(input_size=N_FEATURES, hidden_size=128, num_layers=2, dropout=0.3)
    model.load_state_dict(torch.load(MODELS / "gru_best.pt", map_location=device))
    model.to(device).eval()

    ds = PossessionDataset(X, lengths, y)
    from torch.utils.data import DataLoader
    loader = DataLoader(ds, batch_size=512, shuffle=False)

    all_probs = []
    with torch.no_grad():
        for Xb, Lb, _ in loader:
            logits = model(Xb.to(device), Lb.to(device))
            all_probs.append(torch.sigmoid(logits).cpu().numpy())

    probs = np.concatenate(all_probs)
    return probs, y, df


def baseline_predict(split: str) -> tuple[np.ndarray, np.ndarray, pd.DataFrame]:
    model = joblib.load(MODELS / "baseline_logreg.pkl")
    splits_dir = PROCESSED / "splits"
    poss_path = PROCESSED / "possessions" / "possessions.parquet"

    match_ids = pd.read_csv(splits_dir / f"{split}_matches.csv")["match_id"].tolist()
    df = pd.read_parquet(poss_path)
    df = df[df["match_id"].isin(match_ids)].reset_index(drop=True)

    X = df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    probs = model.predict_proba(X)[:, 1]
    y = df["ends_in_shot"].values.astype(np.float32)
    return probs, y, df


def report(probs, y, label: str) -> dict:
    return {
        "label": label,
        "n": int(len(y)),
        "positive_rate": float(y.mean()),
        "roc_auc": float(roc_auc_score(y, probs)),
        "pr_auc": float(average_precision_score(y, probs)),
        "log_loss": float(log_loss(y, probs)),
        "brier": float(brier_score_loss(y, probs)),
    }


def print_metrics(m: dict):
    print(
        f"  {m['label']:30s} | n={m['n']:5d} | "
        f"ROC={m['roc_auc']:.4f}  PR={m['pr_auc']:.4f}  "
        f"LogLoss={m['log_loss']:.4f}  Brier={m['brier']:.4f}"
    )


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}\n")

    all_results = []

    for split in ["validation", "test"]:
        print(f"=== {split.upper()} ===")

        gru_probs, y, gru_df = gru_predict(split, device)
        bl_probs, _, bl_df = baseline_predict(split)

        # Overall
        m_gru = report(gru_probs, y, f"GRU [{split}]")
        m_bl = report(bl_probs, _, f"Baseline [{split}]")
        print_metrics(m_gru)
        print_metrics(m_bl)
        all_results += [m_gru, m_bl]

        # Per competition
        print(f"\n  Per-competition [{split}]:")
        for comp, idx in gru_df.groupby("competition_label").groups.items():
            g = report(gru_probs[idx], y[idx], f"  GRU {comp}")
            b = report(bl_probs[idx], _[idx], f"  BL  {comp}")
            print_metrics(g)
            print_metrics(b)
            all_results += [g, b]
        print()

    out = MODELS / "gru_eval_results.json"
    with open(out, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"Results saved: {out}")


if __name__ == "__main__":
    main()
