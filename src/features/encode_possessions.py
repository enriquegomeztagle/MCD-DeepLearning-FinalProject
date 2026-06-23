"""
Encode possession event sequences into padded tensors for the LSTM model.

Vocabulary for event types, play patterns, zones.
Returns:
  - X_seq  : (N, T, F) float32 tensor  — padded event feature sequences
  - lengths : (N,) int64 tensor         — true sequence lengths
  - y       : (N,) float32 tensor       — binary labels
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"

# Canonical vocabularies (fitted on full training set, but defined statically
# to keep inference code decoupled from the dataset)
EVENT_TYPES = [
    "Pass", "Carry", "Ball Receipt*", "Pressure", "Dribble",
    "Ball Recovery", "Clearance", "Interception", "Duel", "Foul Committed",
    "Foul Won", "Block", "Miscontrol", "Dispossessed", "Dribbled Past",
    "50/50", "Goal Keeper", "Offside", "Shield", "Error",
    "Own Goal For", "Own Goal Against", "Unknown",
]

PLAY_PATTERNS = [
    "Regular Play", "From Corner", "From Free Kick", "From Throw In",
    "From Goal Kick", "From Keeper", "From Kick Off", "Unknown",
]

ZONES = ["defensive", "middle", "attacking", "Unknown"]

EVENT_TYPE_MAP = {v: i for i, v in enumerate(EVENT_TYPES)}
PLAY_PATTERN_MAP = {v: i for i, v in enumerate(PLAY_PATTERNS)}
ZONE_MAP = {v: i for i, v in enumerate(ZONES)}

N_EVENT_TYPES = len(EVENT_TYPES)
N_PLAY_PATTERNS = len(PLAY_PATTERNS)
N_ZONES = len(ZONES)

# Continuous features per event (after normalisation)
# [x_norm, y_norm, end_x_norm, end_y_norm, duration_norm, under_pressure]
N_CONT = 6

# Total features per time step
N_FEATURES = N_EVENT_TYPES + N_PLAY_PATTERNS + N_ZONES + N_CONT

FIELD_X = 120.0
FIELD_Y = 80.0
MAX_DURATION = 10.0
MAX_SEQ_LEN = 50  # pad/truncate all sequences to this length


def _zone(x: float | None) -> str:
    if x is None:
        return "Unknown"
    if x < 40:
        return "defensive"
    if x < 80:
        return "middle"
    return "attacking"


def encode_event(ev: dict) -> np.ndarray:
    """Encode a single event dict into a float32 feature vector."""
    vec = np.zeros(N_FEATURES, dtype=np.float32)

    # One-hot: event type
    et_idx = EVENT_TYPE_MAP.get(ev.get("event_type", "Unknown"), EVENT_TYPE_MAP["Unknown"])
    vec[et_idx] = 1.0

    # One-hot: play pattern
    pp_idx = PLAY_PATTERN_MAP.get(ev.get("play_pattern", "Unknown"), PLAY_PATTERN_MAP["Unknown"])
    vec[N_EVENT_TYPES + pp_idx] = 1.0

    # One-hot: zone derived from x
    z_idx = ZONE_MAP.get(_zone(ev.get("x")), ZONE_MAP["Unknown"])
    vec[N_EVENT_TYPES + N_PLAY_PATTERNS + z_idx] = 1.0

    # Continuous features
    offset = N_EVENT_TYPES + N_PLAY_PATTERNS + N_ZONES
    x = ev.get("x")
    y = ev.get("y")
    ex = ev.get("end_x")
    ey = ev.get("end_y")
    dur = ev.get("duration")
    up = ev.get("under_pressure", 0)

    vec[offset + 0] = (x / FIELD_X) if x is not None else 0.5
    vec[offset + 1] = (y / FIELD_Y) if y is not None else 0.5
    vec[offset + 2] = (ex / FIELD_X) if ex is not None else 0.5
    vec[offset + 3] = (ey / FIELD_Y) if ey is not None else 0.5
    vec[offset + 4] = min(dur / MAX_DURATION, 1.0) if dur is not None else 0.0
    vec[offset + 5] = float(up)

    return vec


def encode_possession_sequence(events_json: str) -> np.ndarray:
    """Return (T, N_FEATURES) array for one possession's event list."""
    events = json.loads(events_json)
    vecs = [encode_event(ev) for ev in events]
    if not vecs:
        vecs = [np.zeros(N_FEATURES, dtype=np.float32)]
    return np.stack(vecs, axis=0)


def build_tensors(df: pd.DataFrame, max_seq: int = MAX_SEQ_LEN):
    """
    Convert a DataFrame of possessions into padded numpy arrays.

    Returns:
        X     : (N, max_seq, N_FEATURES) float32
        lengths: (N,) int64
        y     : (N,) float32
    """
    N = len(df)
    X = np.zeros((N, max_seq, N_FEATURES), dtype=np.float32)
    lengths = np.zeros(N, dtype=np.int64)
    y = df["ends_in_shot"].values.astype(np.float32)

    for i, events_json in enumerate(df["events_json"]):
        seq = encode_possession_sequence(events_json)
        T = min(len(seq), max_seq)
        X[i, :T, :] = seq[:T]
        lengths[i] = T

    return X, lengths, y


def load_split_tensors(split: str = "train", max_seq: int = MAX_SEQ_LEN):
    """Load a split and return (X, lengths, y, df)."""
    splits_dir = PROCESSED / "splits"
    poss_path = PROCESSED / "possessions" / "possessions.parquet"

    match_ids = pd.read_csv(splits_dir / f"{split}_matches.csv")["match_id"].tolist()
    df = pd.read_parquet(poss_path)
    df = df[df["match_id"].isin(match_ids)].reset_index(drop=True)

    X, lengths, y = build_tensors(df, max_seq)
    return X, lengths, y, df


if __name__ == "__main__":
    print(f"Feature vector size per event: {N_FEATURES}")
    print(f"  Event type one-hot: {N_EVENT_TYPES}")
    print(f"  Play pattern one-hot: {N_PLAY_PATTERNS}")
    print(f"  Zone one-hot: {N_ZONES}")
    print(f"  Continuous: {N_CONT}")
