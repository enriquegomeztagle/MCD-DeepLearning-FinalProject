"""
Master pipeline script — runs all stages in order.

Usage (GPU env):
  C:\\Users\\LUIS1\\OneDrive\\Escritorio\\GPU-Test\\.venv\\Scripts\\python.exe run_pipeline.py [stages]

Stages:
  download   — fetch StatsBomb data
  possessions — build possession dataset
  splits      — create train/val/test splits
  baseline    — train logistic regression baseline
  train       — train GRU model
  evaluate    — final evaluation of all models
  all         — run all stages (default)

Example:
  python run_pipeline.py possessions splits baseline train evaluate
"""

import subprocess
import sys
import time
from pathlib import Path

PYTHON = sys.executable
ROOT = Path(__file__).resolve().parent

STAGES = {
    "download":     ROOT / "src" / "data" / "download_statsbomb.py",
    "possessions":  ROOT / "src" / "data" / "build_possession_dataset.py",
    "splits":       ROOT / "src" / "data" / "create_splits.py",
    "baseline":     ROOT / "src" / "models" / "train_baseline.py",
    "train":        ROOT / "src" / "models" / "train_lstm.py",
    "evaluate":     ROOT / "src" / "evaluation" / "evaluate_lstm.py",
}


def run_stage(name: str, script: Path):
    print(f"\n{'='*60}")
    print(f"  STAGE: {name.upper()}")
    print(f"{'='*60}")
    t0 = time.time()
    result = subprocess.run([PYTHON, str(script)], check=False)
    elapsed = time.time() - t0
    if result.returncode != 0:
        print(f"\n[ERROR] Stage '{name}' failed (exit {result.returncode}) after {elapsed:.1f}s")
        return False
    print(f"\n[OK] Stage '{name}' completed in {elapsed:.1f}s")
    return True


def main():
    args = sys.argv[1:]
    if not args or args == ["all"]:
        selected = list(STAGES.keys())
    else:
        selected = args
        unknown = [s for s in selected if s not in STAGES]
        if unknown:
            print(f"Unknown stages: {unknown}")
            print(f"Available: {list(STAGES.keys())}")
            sys.exit(1)

    print(f"Running stages: {selected}")
    for stage in selected:
        ok = run_stage(stage, STAGES[stage])
        if not ok:
            print(f"\nAborted at stage '{stage}'.")
            sys.exit(1)

    print("\n" + "="*60)
    print("  ALL STAGES COMPLETE")
    print("="*60)


if __name__ == "__main__":
    main()
