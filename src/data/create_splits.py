"""
Create reproducible train/validation/test splits at the match level,
stratified by competition so every split contains all leagues.

Split ratios: 70% train / 15% val / 15% test
"""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedShuffleSplit

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "statsbomb"
PROCESSED = ROOT / "data" / "processed"

SEED = 42
VAL_RATIO = 0.15
TEST_RATIO = 0.15


def _stratified_match_split(manifest: pd.DataFrame, test_size: float, seed: int):
    """Return (remaining_idx, test_idx) stratified by competition_label."""
    splitter = StratifiedShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    idx = np.arange(len(manifest))
    strat_col = manifest["competition_label"].values
    remaining, test = next(splitter.split(idx, strat_col))
    return remaining, test


def main():
    manifest_path = RAW / "matches_manifest.csv"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Run download_statsbomb.py first. Missing: {manifest_path}")

    manifest = pd.read_csv(manifest_path)
    splits_dir = PROCESSED / "splits"
    splits_dir.mkdir(parents=True, exist_ok=True)

    print(f"Creating splits for {len(manifest)} matches (seed={SEED})")
    print(f"  Competition distribution:\n{manifest['competition_label'].value_counts()}\n")

    # Step 1: carve out test set
    remaining_idx, test_idx = _stratified_match_split(manifest, TEST_RATIO, SEED)
    remaining = manifest.iloc[remaining_idx].reset_index(drop=True)
    test_df = manifest.iloc[test_idx].reset_index(drop=True)

    # Step 2: carve out val set from remaining
    # val_ratio relative to the full dataset
    val_of_remaining = VAL_RATIO / (1 - TEST_RATIO)
    train_idx, val_idx = _stratified_match_split(remaining, val_of_remaining, SEED + 1)
    train_df = remaining.iloc[train_idx].reset_index(drop=True)
    val_df = remaining.iloc[val_idx].reset_index(drop=True)

    # Save split files
    train_df.to_csv(splits_dir / "train_matches.csv", index=False)
    val_df.to_csv(splits_dir / "validation_matches.csv", index=False)
    test_df.to_csv(splits_dir / "test_matches.csv", index=False)

    print("Split saved:")
    for name, df in [("train", train_df), ("validation", val_df), ("test", test_df)]:
        comp_dist = df["competition_label"].value_counts().to_dict()
        print(f"  {name:12s}: {len(df):3d} matches | {comp_dist}")

    # Verify no leakage
    all_ids = [set(train_df["match_id"]), set(val_df["match_id"]), set(test_df["match_id"])]
    assert all_ids[0].isdisjoint(all_ids[1]), "Leakage: train/val overlap"
    assert all_ids[0].isdisjoint(all_ids[2]), "Leakage: train/test overlap"
    assert all_ids[1].isdisjoint(all_ids[2]), "Leakage: val/test overlap"
    print("\nNo match ID leakage confirmed.")

    return train_df, val_df, test_df


if __name__ == "__main__":
    main()
