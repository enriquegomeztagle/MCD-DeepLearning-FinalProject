"""
Football Possession Intelligence API
Predicts P(shot | possession) using a trained GRU model.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Path helpers ──────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parents[2]
MODELS_DIR = BASE_DIR / "models" / "trained"
SRC_DIR = BASE_DIR / "src"

import sys
sys.path.insert(0, str(BASE_DIR))

from src.features.encode_possessions import (
    N_FEATURES,
    MAX_SEQ_LEN,
    encode_possession_sequence,
)
from src.models.lstm_model import PossessionGRU

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Football Possession Intelligence API",
    version="1.0.0",
    description="Predicts the probability that a football possession ends in a shot.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Model loading (lazy, on first request) ────────────────────────────────────
_gru_model: Optional[PossessionGRU] = None
_baseline_model = None
_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _load_gru():
    global _gru_model
    if _gru_model is not None:
        return _gru_model
    checkpoint = MODELS_DIR / "gru_best.pt"
    if not checkpoint.exists():
        raise RuntimeError(f"GRU checkpoint not found: {checkpoint}")
    model = PossessionGRU(input_size=N_FEATURES, hidden_size=128, num_layers=2, dropout=0.0)
    model.load_state_dict(torch.load(checkpoint, map_location=_device))
    model.to(_device).eval()
    _gru_model = model
    return model


def _load_baseline():
    global _baseline_model
    if _baseline_model is not None:
        return _baseline_model
    path = MODELS_DIR / "baseline_logreg.pkl"
    if not path.exists():
        raise RuntimeError(f"Baseline model not found: {path}")
    _baseline_model = joblib.load(path)
    return _baseline_model


# ── Request / Response schemas ────────────────────────────────────────────────
class EventRecord(BaseModel):
    event_type: str
    play_pattern: str = "Regular Play"
    x: Optional[float] = None
    y: Optional[float] = None
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    duration: Optional[float] = None
    under_pressure: int = 0
    minute: Optional[int] = None
    second: Optional[int] = None


class PossessionRequest(BaseModel):
    events: list[EventRecord]
    model: str = "gru"  # "gru" or "baseline"


class PossessionResponse(BaseModel):
    shot_probability: float
    model_used: str
    n_events: int
    model_version: str = "1.0.0"
    timestamp: str


class MatchAnalysisRequest(BaseModel):
    match_possessions: list[list[EventRecord]]
    model: str = "gru"


class MatchAnalysisResponse(BaseModel):
    n_possessions: int
    probabilities: list[float]
    top_k_indices: list[int]
    mean_probability: float
    model_used: str


# ── Inference helpers ─────────────────────────────────────────────────────────
def _gru_predict_single(events: list[dict]) -> float:
    model = _load_gru()
    events_json = json.dumps(events)
    seq = encode_possession_sequence(events_json)
    T = min(len(seq), MAX_SEQ_LEN)

    X = np.zeros((1, MAX_SEQ_LEN, N_FEATURES), dtype=np.float32)
    X[0, :T, :] = seq[:T]

    X_t = torch.from_numpy(X).to(_device)
    L_t = torch.tensor([T], dtype=torch.int64)

    with torch.no_grad():
        logit = model(X_t, L_t)
        prob = torch.sigmoid(logit).item()
    return float(prob)


BASELINE_NUMERIC = [
    "n_events", "n_pass", "n_carry", "n_dribble", "n_pressure",
    "n_attacking_third", "start_x", "end_x", "progression",
    "total_duration", "match_minute_start",
]
BASELINE_CAT = ["start_zone", "end_zone", "play_pattern"]


def _events_to_baseline_row(events: list[dict]) -> dict:
    import pandas as pd

    xs = [e.get("x") for e in events if e.get("x") is not None]
    start_x = xs[0] if xs else 60.0
    end_x_val = xs[-1] if xs else 60.0

    def _zone(x):
        if x < 40:
            return "defensive"
        if x < 80:
            return "middle"
        return "attacking"

    n_pass = sum(1 for e in events if e.get("event_type") == "Pass")
    n_carry = sum(1 for e in events if e.get("event_type") == "Carry")
    n_dribble = sum(1 for e in events if e.get("event_type") == "Dribble")
    n_pressure = sum(1 for e in events if e.get("event_type") == "Pressure")
    n_attacking = sum(1 for e in events if e.get("x") is not None and e["x"] > 80)
    durations = [e.get("duration") or 0 for e in events]
    total_dur = sum(durations)
    minutes = [e.get("minute") for e in events if e.get("minute") is not None]
    min_minute = min(minutes) if minutes else 0
    play_pat = events[0].get("play_pattern", "Regular Play") if events else "Regular Play"

    return pd.DataFrame([{
        "n_events": len(events),
        "n_pass": n_pass,
        "n_carry": n_carry,
        "n_dribble": n_dribble,
        "n_pressure": n_pressure,
        "n_attacking_third": n_attacking,
        "start_x": start_x,
        "end_x": end_x_val,
        "progression": end_x_val - start_x,
        "total_duration": total_dur,
        "match_minute_start": min_minute,
        "start_zone": _zone(start_x),
        "end_zone": _zone(end_x_val),
        "play_pattern": play_pat,
    }])


def _baseline_predict_single(events: list[dict]) -> float:
    model = _load_baseline()
    row = _events_to_baseline_row(events)
    prob = model.predict_proba(row)[0, 1]
    return float(prob)


def _predict(events_raw: list[dict], model_name: str) -> float:
    if model_name == "baseline":
        return _baseline_predict_single(events_raw)
    return _gru_predict_single(events_raw)


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "healthy",
        "device": str(_device),
        "gru_ready": (MODELS_DIR / "gru_best.pt").exists(),
        "baseline_ready": (MODELS_DIR / "baseline_logreg.pkl").exists(),
    }


@app.get("/v1/models")
def list_models():
    return {
        "models": [
            {"id": "gru", "description": "GRU sequence model for P(shot|possession)"},
            {"id": "baseline", "description": "Logistic regression on aggregate features"},
        ]
    }


@app.post("/v1/predict-possession", response_model=PossessionResponse)
def predict_possession(req: PossessionRequest):
    if not req.events:
        raise HTTPException(status_code=422, detail="events list cannot be empty")
    events_raw = [e.model_dump() for e in req.events]
    try:
        prob = _predict(events_raw, req.model)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return PossessionResponse(
        shot_probability=round(prob, 6),
        model_used=req.model,
        n_events=len(req.events),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/v1/analyze-match", response_model=MatchAnalysisResponse)
def analyze_match(req: MatchAnalysisRequest):
    if not req.match_possessions:
        raise HTTPException(status_code=422, detail="match_possessions cannot be empty")
    probs = []
    for poss in req.match_possessions:
        events_raw = [e.model_dump() for e in poss]
        try:
            p = _predict(events_raw, req.model)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        probs.append(round(p, 6))

    sorted_idx = sorted(range(len(probs)), key=lambda i: probs[i], reverse=True)
    return MatchAnalysisResponse(
        n_possessions=len(probs),
        probabilities=probs,
        top_k_indices=sorted_idx[:5],
        mean_probability=round(float(np.mean(probs)), 6),
        model_used=req.model,
    )


# Legacy compatibility endpoint
@app.post("/v1/predictions")
def predict_legacy(body: dict):
    return {
        "message": "Use POST /v1/predict-possession instead.",
        "docs": "/docs",
    }
