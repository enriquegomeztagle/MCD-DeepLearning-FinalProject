"""
Train a logistic regression baseline on possession-level aggregate features.
No sequence modeling — uses tabular summaries per possession.

Saves:
  models/trained/baseline_logreg.pkl
  models/trained/baseline_encoder.pkl
"""

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.compose import ColumnTransformer

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"
MODELS = ROOT / "models" / "trained"

NUMERIC_FEATURES = [
    "n_events", "n_pass", "n_carry", "n_dribble", "n_pressure",
    "n_attacking_third", "start_x", "end_x", "progression",
    "total_duration", "match_minute_start",
]
CATEGORICAL_FEATURES = ["start_zone", "end_zone", "play_pattern"]


def load_split(split: str) -> pd.DataFrame:
    splits_dir = PROCESSED / "splits"
    poss_path = PROCESSED / "possessions" / "possessions.parquet"
    match_ids = pd.read_csv(splits_dir / f"{split}_matches.csv")["match_id"].tolist()
    df = pd.read_parquet(poss_path)
    return df[df["match_id"].isin(match_ids)].reset_index(drop=True)


def build_pipeline() -> Pipeline:
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), NUMERIC_FEATURES),
            (
                "cat",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                CATEGORICAL_FEATURES,
            ),
        ]
    )
    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("clf", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42)),
        ]
    )


def evaluate(model: Pipeline, df: pd.DataFrame, split_name: str) -> dict:
    X = df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y = df["ends_in_shot"].values
    probs = model.predict_proba(X)[:, 1]

    metrics = {
        "split": split_name,
        "n": len(y),
        "positive_rate": float(y.mean()),
        "roc_auc": float(roc_auc_score(y, probs)),
        "pr_auc": float(average_precision_score(y, probs)),
        "log_loss": float(log_loss(y, probs)),
        "brier": float(brier_score_loss(y, probs)),
    }
    return metrics


def main():
    MODELS.mkdir(parents=True, exist_ok=True)

    print("Loading splits...")
    train_df = load_split("train")
    val_df = load_split("validation")
    test_df = load_split("test")

    print(f"  Train: {len(train_df):,} possessions")
    print(f"  Val  : {len(val_df):,} possessions")
    print(f"  Test : {len(test_df):,} possessions")

    X_train = train_df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y_train = train_df["ends_in_shot"].values

    print("\nTraining logistic regression baseline...")
    model = build_pipeline()
    model.fit(X_train, y_train)

    # Evaluate on all splits
    results = []
    for split_name, df in [("train", train_df), ("validation", val_df), ("test", test_df)]:
        m = evaluate(model, df, split_name)
        results.append(m)
        print(
            f"  {split_name:12s} | ROC-AUC={m['roc_auc']:.4f} "
            f"PR-AUC={m['pr_auc']:.4f} LogLoss={m['log_loss']:.4f}"
        )

    # Per-competition breakdown on validation
    print("\nValidation — per competition:")
    for comp, grp in val_df.groupby("competition_label"):
        m = evaluate(model, grp, comp)
        print(
            f"  {comp:20s} | n={m['n']:4d} | ROC-AUC={m['roc_auc']:.4f} "
            f"PR-AUC={m['pr_auc']:.4f}"
        )

    # Save model and results
    model_path = MODELS / "baseline_logreg.pkl"
    joblib.dump(model, model_path)
    print(f"\nModel saved: {model_path}")

    results_path = MODELS / "baseline_results.json"
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Results saved: {results_path}")

    return model


if __name__ == "__main__":
    main()
