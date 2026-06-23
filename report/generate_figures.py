"""
Generate all figures for the LaTeX report.
Run with the GPU venv Python from the project root.
"""

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
import pandas as pd
import torch
import joblib
from sklearn.metrics import (
    roc_curve, precision_recall_curve,
    roc_auc_score, average_precision_score,
    brier_score_loss,
)
from sklearn.calibration import calibration_curve

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.features.encode_possessions import N_FEATURES, load_split_tensors, MAX_SEQ_LEN
from src.models.lstm_model import PossessionGRU
from src.models.dataset import PossessionDataset
from torch.utils.data import DataLoader

PROCESSED = ROOT / "data" / "processed"
MODELS    = ROOT / "models" / "trained"
FIGS      = ROOT / "report" / "figures"
FIGS.mkdir(parents=True, exist_ok=True)

PALETTE = {"gru": "#2563eb", "baseline": "#dc2626", "neutral": "#475569"}
COMP_COLORS = {"Bundesliga_2324": "#f59e0b", "LaLiga_2021": "#ef4444",
               "Ligue1_2122":    "#10b981", "Ligue1_2223": "#3b82f6"}
COMP_LABELS = {"Bundesliga_2324": "Bundesliga 23/24", "LaLiga_2021": "La Liga 20/21",
               "Ligue1_2122":    "Ligue 1 21/22",    "Ligue1_2223": "Ligue 1 22/23"}

plt.rcParams.update({
    "font.family": "serif", "font.size": 11,
    "axes.spines.top": False, "axes.spines.right": False,
    "figure.dpi": 150, "savefig.bbox": "tight", "savefig.dpi": 150,
})

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Device: {device}")

# ── helpers ───────────────────────────────────────────────────────────────────
NUMERIC_FEATURES = [
    "n_events","n_pass","n_carry","n_dribble","n_pressure",
    "n_attacking_third","start_x","end_x","progression",
    "total_duration","match_minute_start",
]
CATEGORICAL_FEATURES = ["start_zone","end_zone","play_pattern"]

def load_poss():
    return pd.read_parquet(PROCESSED / "possessions" / "possessions.parquet")

def load_split_df(split):
    mids = pd.read_csv(PROCESSED/"splits"/f"{split}_matches.csv")["match_id"].tolist()
    df = load_poss()
    return df[df["match_id"].isin(mids)].reset_index(drop=True)

def gru_probs(split):
    X, L, y, df = load_split_tensors(split, MAX_SEQ_LEN)
    model = PossessionGRU(N_FEATURES, 128, 2, 0.0)
    model.load_state_dict(torch.load(MODELS/"gru_best.pt", map_location=device))
    model.to(device).eval()
    loader = DataLoader(PossessionDataset(X, L, y), 512, shuffle=False)
    probs = []
    with torch.no_grad():
        for xb, lb, _ in loader:
            probs.append(torch.sigmoid(model(xb.to(device), lb.to(device))).cpu().numpy())
    return np.concatenate(probs), y, df

def bl_probs(split):
    bl = joblib.load(MODELS/"baseline_logreg.pkl")
    df = load_split_df(split)
    p = bl.predict_proba(df[NUMERIC_FEATURES+CATEGORICAL_FEATURES])[:,1]
    return p, df["ends_in_shot"].values.astype(np.float32), df


# ═══════════════════════════════════════════════════════════════════════════════
# FIG 1 — Label distribution
# ═══════════════════════════════════════════════════════════════════════════════
def fig_label_dist():
    df = load_poss()
    counts = df["ends_in_shot"].value_counts().sort_index()
    fig, ax = plt.subplots(figsize=(5, 3.5))
    bars = ax.bar(["Sin disparo\n(clase 0)", "Con disparo\n(clase 1)"],
                  counts.values, color=[PALETTE["neutral"], PALETTE["gru"]],
                  width=0.5, edgecolor="white", linewidth=1.2)
    for bar, v in zip(bars, counts.values):
        ax.text(bar.get_x()+bar.get_width()/2, v+200, f"{v:,}", ha="center",
                fontsize=10, fontweight="bold")
    ax.set_ylabel("Número de posesiones")
    ax.set_title("Distribución de clases", fontweight="bold")
    ax.set_ylim(0, counts.max()*1.15)
    ax.annotate(f"Tasa positiva: {df['ends_in_shot'].mean():.1%}",
                xy=(0.98, 0.92), xycoords="axes fraction", ha="right",
                fontsize=10, color=PALETTE["gru"],
                bbox=dict(boxstyle="round,pad=0.3", fc="#eff6ff", ec=PALETTE["gru"]))
    fig.tight_layout()
    fig.savefig(FIGS/"label_distribution.pdf")
    fig.savefig(FIGS/"label_distribution.png")
    plt.close()
    print("  fig1 done")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 2 — Shot rate por competencia
# ═══════════════════════════════════════════════════════════════════════════════
def fig_shot_rate_comp():
    df = load_poss()
    stats = df.groupby("competition_label").agg(
        n=("ends_in_shot","count"), rate=("ends_in_shot","mean")
    ).reset_index()
    stats["label"] = stats["competition_label"].map(COMP_LABELS)

    fig, ax = plt.subplots(figsize=(6.5, 3.5))
    colors = [COMP_COLORS[c] for c in stats["competition_label"]]
    bars = ax.barh(stats["label"], stats["rate"]*100, color=colors,
                   edgecolor="white", height=0.55)
    for bar, row in zip(bars, stats.itertuples()):
        ax.text(bar.get_width()+0.1, bar.get_y()+bar.get_height()/2,
                f"{row.rate:.1%}  (n={row.n:,})", va="center", fontsize=9.5)
    ax.set_xlabel("Tasa de posesiones con disparo (%)")
    ax.set_title("Tasa de disparo por competencia", fontweight="bold")
    ax.set_xlim(0, 20)
    fig.tight_layout()
    fig.savefig(FIGS/"shot_rate_by_competition.pdf")
    fig.savefig(FIGS/"shot_rate_by_competition.png")
    plt.close()
    print("  fig2 done")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 3 — Longitud de secuencia por clase
# ═══════════════════════════════════════════════════════════════════════════════
def fig_seq_length():
    df = load_poss()
    fig, axes = plt.subplots(1, 2, figsize=(9, 3.5), sharey=False)
    for ax, (label, color, title) in zip(axes, [
        (0, PALETTE["neutral"], "Sin disparo (clase 0)"),
        (1, PALETTE["gru"],    "Con disparo (clase 1)"),
    ]):
        s = df[df["ends_in_shot"]==label]["n_events"].clip(upper=35)
        ax.hist(s, bins=35, color=color, alpha=0.85, edgecolor="white")
        med = df[df["ends_in_shot"]==label]["n_events"].median()
        ax.axvline(med, color="black", ls="--", lw=1.5, label=f"Mediana={med:.0f}")
        ax.set_title(title, fontweight="bold")
        ax.set_xlabel("Eventos por posesión")
        ax.set_ylabel("Frecuencia")
        ax.legend(fontsize=9)
    fig.suptitle("Distribución de longitud de secuencia por clase", fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(FIGS/"sequence_length.pdf")
    fig.savefig(FIGS/"sequence_length.png")
    plt.close()
    print("  fig3 done")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 4 — Progresión territorial
# ═══════════════════════════════════════════════════════════════════════════════
def fig_territory():
    df = load_poss()
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.5))
    feats = [("start_x","Posición inicial X"),
             ("end_x",  "Posición final X"),
             ("progression","Progresion (end_x - start_x)")]
    for ax, (feat, title) in zip(axes, feats):
        for label, color, lbl in [(0, PALETTE["neutral"],"Sin disparo"),
                                   (1, PALETTE["gru"],   "Con disparo")]:
            ax.hist(df[df["ends_in_shot"]==label][feat], bins=40,
                    color=color, alpha=0.55, density=True, label=lbl)
        ax.set_title(title, fontsize=10, fontweight="bold")
        ax.set_xlabel("Metros (campo 0–120)")
        ax.set_ylabel("Densidad")
    axes[0].legend(fontsize=8)
    fig.suptitle("Características territoriales por clase", fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(FIGS/"territory_features.pdf")
    fig.savefig(FIGS/"territory_features.png")
    plt.close()
    print("  fig4 done")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 5 — Play pattern
# ═══════════════════════════════════════════════════════════════════════════════
def fig_play_pattern():
    df = load_poss()
    pp = df.groupby("play_pattern").agg(
        n=("ends_in_shot","count"), rate=("ends_in_shot","mean")
    ).sort_values("rate")
    # keep top-8 by count
    pp = pp[pp["n"] > 100].sort_values("rate")
    colors = [PALETTE["gru"] if r > 0.14 else PALETTE["neutral"] for r in pp["rate"]]
    fig, ax = plt.subplots(figsize=(8, 4))
    bars = ax.barh(pp.index, pp["rate"]*100, color=colors, edgecolor="white", height=0.6)
    for bar, (_, row) in zip(bars, pp.iterrows()):
        ax.text(bar.get_width()+0.1, bar.get_y()+bar.get_height()/2,
                f"{row['rate']:.1%}  n={row['n']:,}", va="center", fontsize=9)
    ax.set_xlabel("Tasa de disparo (%)")
    ax.set_title("Tasa de disparo por patrón de juego", fontweight="bold")
    ax.set_xlim(0, 30)
    fig.tight_layout()
    fig.savefig(FIGS/"play_pattern.pdf")
    fig.savefig(FIGS/"play_pattern.png")
    plt.close()
    print("  fig5 done")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 6 — Training curves
# ═══════════════════════════════════════════════════════════════════════════════
def fig_training_curves():
    with open(MODELS/"gru_train_log.json") as f:
        log = json.load(f)
    epochs    = [e["epoch"] for e in log]
    tr_loss   = [e["train_loss"] for e in log]
    va_loss   = [e["val_loss"] for e in log]
    va_roc    = [e["val_roc_auc"] for e in log]
    va_pr     = [e["val_pr_auc"] for e in log]
    best_ep   = max(log, key=lambda e: e["val_pr_auc"])["epoch"]

    fig, axes = plt.subplots(1, 3, figsize=(13, 3.8))

    axes[0].plot(epochs, tr_loss, color=PALETTE["gru"], label="Entrenamiento")
    axes[0].plot(epochs, va_loss, color=PALETTE["baseline"], ls="--", label="Validación")
    axes[0].axvline(best_ep, color="gray", ls=":", lw=1.2, label=f"Mejor (ep.{best_ep})")
    axes[0].set_title("BCE Loss", fontweight="bold"); axes[0].set_xlabel("Época")
    axes[0].legend(fontsize=8)

    axes[1].plot(epochs, va_roc, color=PALETTE["gru"])
    axes[1].axvline(best_ep, color="gray", ls=":", lw=1.2)
    axes[1].set_title("Val ROC-AUC", fontweight="bold"); axes[1].set_xlabel("Época")
    axes[1].set_ylim(0.75, 1.0)

    axes[2].plot(epochs, va_pr, color=PALETTE["gru"])
    axes[2].axvline(best_ep, color="gray", ls=":", lw=1.2)
    axes[2].set_title("Val PR-AUC", fontweight="bold"); axes[2].set_xlabel("Época")
    axes[2].set_ylim(0.3, 1.0)

    fig.suptitle("Curvas de entrenamiento — GRU", fontweight="bold")
    fig.tight_layout()
    fig.savefig(FIGS/"training_curves.pdf")
    fig.savefig(FIGS/"training_curves.png")
    plt.close()
    print("  fig6 done")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 7 — ROC y PR curves (val + test, GRU vs Baseline)
# ═══════════════════════════════════════════════════════════════════════════════
def fig_roc_pr():
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))

    for split, ls in [("validation","--"), ("test","-")]:
        gp, y, _ = gru_probs(split)
        bp, _y, _ = bl_probs(split)

        fpr_g, tpr_g, _ = roc_curve(y, gp)
        fpr_b, tpr_b, _ = roc_curve(y, bp)
        pr_g, rc_g, _   = precision_recall_curve(y, gp)
        pr_b, rc_b, _   = precision_recall_curve(y, bp)

        roc_g = roc_auc_score(y, gp); pr_auc_g = average_precision_score(y, gp)
        roc_b = roc_auc_score(y, bp); pr_auc_b = average_precision_score(y, bp)
        split_lbl = "Val" if split=="validation" else "Test"

        axes[0].plot(fpr_g, tpr_g, ls=ls, color=PALETTE["gru"],
                     label=f"GRU {split_lbl} ({roc_g:.3f})")
        axes[0].plot(fpr_b, tpr_b, ls=ls, color=PALETTE["baseline"],
                     label=f"Baseline {split_lbl} ({roc_b:.3f})")
        axes[1].plot(rc_g, pr_g, ls=ls, color=PALETTE["gru"],
                     label=f"GRU {split_lbl} ({pr_auc_g:.3f})")
        axes[1].plot(rc_b, pr_b, ls=ls, color=PALETTE["baseline"],
                     label=f"Baseline {split_lbl} ({pr_auc_b:.3f})")

    axes[0].plot([0,1],[0,1],"k:", alpha=0.4, lw=1)
    axes[0].set_xlabel("Tasa de Falsos Positivos"); axes[0].set_ylabel("Tasa de Verdaderos Positivos")
    axes[0].set_title("Curva ROC", fontweight="bold"); axes[0].legend(fontsize=8)

    axes[1].set_xlabel("Recall"); axes[1].set_ylabel("Precisión")
    axes[1].set_title("Curva Precisión-Recall", fontweight="bold"); axes[1].legend(fontsize=8)

    fig.tight_layout()
    fig.savefig(FIGS/"roc_pr_curves.pdf")
    fig.savefig(FIGS/"roc_pr_curves.png")
    plt.close()
    print("  fig7 done")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 8 — Per-competition PR-AUC comparison
# ═══════════════════════════════════════════════════════════════════════════════
def fig_per_competition():
    gp, y, gdf = gru_probs("test")
    bp, yb, bdf = bl_probs("test")

    comps = sorted(gdf["competition_label"].unique())
    x = np.arange(len(comps))
    w = 0.35

    gru_pr, bl_pr = [], []
    for comp in comps:
        idx_g = gdf[gdf["competition_label"]==comp].index.tolist()
        idx_b = bdf[bdf["competition_label"]==comp].index.tolist()
        gru_pr.append(average_precision_score(y[idx_g], gp[idx_g]))
        bl_pr.append(average_precision_score(yb[idx_b], bp[idx_b]))

    fig, ax = plt.subplots(figsize=(8, 4))
    b1 = ax.bar(x - w/2, gru_pr, w, color=PALETTE["gru"], label="GRU", edgecolor="white")
    b2 = ax.bar(x + w/2, bl_pr,  w, color=PALETTE["baseline"], label="Baseline", edgecolor="white")
    for bar, v in list(zip(b1, gru_pr)) + list(zip(b2, bl_pr)):
        ax.text(bar.get_x()+bar.get_width()/2, bar.get_height()+0.005,
                f"{v:.3f}", ha="center", fontsize=8.5, fontweight="bold")
    ax.set_xticks(x)
    ax.set_xticklabels([COMP_LABELS[c] for c in comps], rotation=10)
    ax.set_ylabel("PR-AUC")
    ax.set_title("PR-AUC por competencia — Conjunto de prueba", fontweight="bold")
    ax.set_ylim(0, 1.05)
    ax.legend()
    fig.tight_layout()
    fig.savefig(FIGS/"per_competition_pr_auc.pdf")
    fig.savefig(FIGS/"per_competition_pr_auc.png")
    plt.close()
    print("  fig8 done")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 9 — Calibration curves
# ═══════════════════════════════════════════════════════════════════════════════
def fig_calibration():
    gp, y, _ = gru_probs("validation")
    bp, yb, _ = bl_probs("validation")

    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    for ax, probs, label, color in [
        (axes[0], gp, "GRU",      PALETTE["gru"]),
        (axes[1], bp, "Baseline", PALETTE["baseline"]),
    ]:
        fp, mp = calibration_curve(y, probs, n_bins=10)
        ax.plot(mp, fp, "o-", color=color, label=label, lw=2)
        ax.plot([0,1],[0,1],"k--", alpha=0.5, label="Calibración perfecta")
        ax.set_xlabel("Probabilidad predicha"); ax.set_ylabel("Fracción de positivos")
        ax.set_title(f"Calibración — {label}", fontweight="bold")
        ax.legend(fontsize=9)
    fig.tight_layout()
    fig.savefig(FIGS/"calibration_curves.pdf")
    fig.savefig(FIGS/"calibration_curves.png")
    plt.close()
    print("  fig9 done")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 10 — Metrics summary bar chart
# ═══════════════════════════════════════════════════════════════════════════════
def fig_metrics_summary():
    # Val metrics from evaluation
    metrics = {
        "ROC-AUC\n(Val)":  {"GRU": 0.9592, "Baseline": 0.8904},
        "PR-AUC\n(Val)":   {"GRU": 0.8522, "Baseline": 0.5857},
        "ROC-AUC\n(Test)": {"GRU": 0.9649, "Baseline": 0.8756},
        "PR-AUC\n(Test)":  {"GRU": 0.8703, "Baseline": 0.5635},
    }
    labels = list(metrics.keys())
    gru_vals = [metrics[k]["GRU"] for k in labels]
    bl_vals  = [metrics[k]["Baseline"] for k in labels]
    x = np.arange(len(labels)); w = 0.35

    fig, ax = plt.subplots(figsize=(9, 4))
    b1 = ax.bar(x - w/2, gru_vals, w, color=PALETTE["gru"],      label="GRU", edgecolor="white")
    b2 = ax.bar(x + w/2, bl_vals,  w, color=PALETTE["baseline"], label="Baseline", edgecolor="white")
    for bar, v in list(zip(b1, gru_vals)) + list(zip(b2, bl_vals)):
        ax.text(bar.get_x()+bar.get_width()/2, bar.get_height()+0.005,
                f"{v:.3f}", ha="center", fontsize=9, fontweight="bold")
    ax.set_xticks(x); ax.set_xticklabels(labels)
    ax.set_ylim(0, 1.08)
    ax.set_ylabel("Métrica")
    ax.set_title("Resumen de métricas — GRU vs Baseline", fontweight="bold")
    ax.legend()
    fig.tight_layout()
    fig.savefig(FIGS/"metrics_summary.pdf")
    fig.savefig(FIGS/"metrics_summary.png")
    plt.close()
    print("  fig10 done")


if __name__ == "__main__":
    print("Generating figures...")
    fig_label_dist()
    fig_shot_rate_comp()
    fig_seq_length()
    fig_territory()
    fig_play_pattern()
    fig_training_curves()
    fig_roc_pr()
    fig_per_competition()
    fig_calibration()
    fig_metrics_summary()
    print(f"\nAll figures saved to {FIGS}")
