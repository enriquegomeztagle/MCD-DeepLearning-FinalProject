"""
Train the GRU possession classifier.

Usage (GPU):
  C:\\Users\\LUIS1\\OneDrive\\Escritorio\\GPU-Test\\.venv\\Scripts\\python.exe src/models/train_lstm.py

Saves:
  models/trained/gru_best.pt       (best validation PR-AUC checkpoint)
  models/trained/gru_last.pt       (final epoch checkpoint)
  models/trained/gru_train_log.json (per-epoch metrics)
"""

import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import average_precision_score, roc_auc_score
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from src.features.encode_possessions import N_FEATURES, load_split_tensors, MAX_SEQ_LEN
from src.models.dataset import PossessionDataset
from src.models.lstm_model import PossessionGRU

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "models" / "trained"

# ── Hyperparameters ────────────────────────────────────────────────────────────
HIDDEN = 128
LAYERS = 2
DROPOUT = 0.3
PROJ = 64
LR = 3e-4
WEIGHT_DECAY = 1e-4
EPOCHS = 40
BATCH = 256
PATIENCE = 8


def compute_pos_weight(y: np.ndarray) -> float:
    """Compute positive class weight for imbalanced BCE."""
    n_pos = y.sum()
    n_neg = len(y) - n_pos
    return float(n_neg / max(n_pos, 1))


def evaluate_epoch(model, loader, criterion, device):
    model.eval()
    total_loss = 0.0
    all_probs, all_labels = [], []

    with torch.no_grad():
        for X, lengths, y in loader:
            X, lengths, y = X.to(device), lengths.to(device), y.to(device)
            logits = model(X, lengths)
            loss = criterion(logits, y)
            total_loss += loss.item() * len(y)
            probs = torch.sigmoid(logits).cpu().numpy()
            all_probs.extend(probs.tolist())
            all_labels.extend(y.cpu().numpy().tolist())

    probs_arr = np.array(all_probs)
    labels_arr = np.array(all_labels)
    avg_loss = total_loss / len(all_labels)
    roc = roc_auc_score(labels_arr, probs_arr)
    pr = average_precision_score(labels_arr, probs_arr)
    return avg_loss, roc, pr


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    MODELS.mkdir(parents=True, exist_ok=True)

    # Load data
    print("Loading splits...")
    X_tr, L_tr, y_tr, _ = load_split_tensors("train", MAX_SEQ_LEN)
    X_va, L_va, y_va, _ = load_split_tensors("validation", MAX_SEQ_LEN)

    pos_w = compute_pos_weight(y_tr)
    print(f"  Train: {len(y_tr):,} | pos rate={y_tr.mean():.3f} | pos_weight={pos_w:.2f}")
    print(f"  Val  : {len(y_va):,} | pos rate={y_va.mean():.3f}")

    train_loader = DataLoader(
        PossessionDataset(X_tr, L_tr, y_tr), batch_size=BATCH, shuffle=True, num_workers=0
    )
    val_loader = DataLoader(
        PossessionDataset(X_va, L_va, y_va), batch_size=BATCH, shuffle=False, num_workers=0
    )

    model = PossessionGRU(
        input_size=N_FEATURES,
        hidden_size=HIDDEN,
        num_layers=LAYERS,
        dropout=DROPOUT,
        proj_size=PROJ,
    ).to(device)
    print(f"\nModel parameters: {sum(p.numel() for p in model.parameters()):,}")

    criterion = nn.BCEWithLogitsLoss(
        pos_weight=torch.tensor(pos_w, device=device)
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS)

    best_pr_auc = 0.0
    patience_counter = 0
    log = []

    print("\nTraining...")
    for epoch in range(1, EPOCHS + 1):
        model.train()
        train_loss = 0.0
        for X, lengths, y in train_loader:
            X, lengths, y = X.to(device), lengths.to(device), y.to(device)
            optimizer.zero_grad()
            logits = model(X, lengths)
            loss = criterion(logits, y)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            train_loss += loss.item() * len(y)
        train_loss /= len(y_tr)

        val_loss, val_roc, val_pr = evaluate_epoch(model, val_loader, criterion, device)
        scheduler.step()

        entry = {
            "epoch": epoch,
            "train_loss": round(train_loss, 5),
            "val_loss": round(val_loss, 5),
            "val_roc_auc": round(val_roc, 5),
            "val_pr_auc": round(val_pr, 5),
        }
        log.append(entry)

        improved = val_pr > best_pr_auc
        if improved:
            best_pr_auc = val_pr
            patience_counter = 0
            torch.save(model.state_dict(), MODELS / "gru_best.pt")
            tag = " *"
        else:
            patience_counter += 1
            tag = ""

        print(
            f"Epoch {epoch:3d}/{EPOCHS} | "
            f"train_loss={train_loss:.4f} val_loss={val_loss:.4f} "
            f"ROC={val_roc:.4f} PR={val_pr:.4f}{tag}"
        )

        if patience_counter >= PATIENCE:
            print(f"Early stopping at epoch {epoch}")
            break

    torch.save(model.state_dict(), MODELS / "gru_last.pt")
    with open(MODELS / "gru_train_log.json", "w") as f:
        json.dump(log, f, indent=2)

    print(f"\nBest val PR-AUC: {best_pr_auc:.4f}")
    print(f"Checkpoints saved to {MODELS}")


if __name__ == "__main__":
    main()
