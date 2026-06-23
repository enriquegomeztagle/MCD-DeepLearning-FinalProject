"""
Parse downloaded StatsBomb event JSON files (statsbombpy flat format) and build
a possession-level dataset.

Output: data/processed/possessions/possessions.parquet
"""

import json
from pathlib import Path

import pandas as pd
from tqdm import tqdm

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "statsbomb"
PROCESSED = ROOT / "data" / "processed" / "possessions"

EXCLUDE_TYPES = {
    "Starting XI", "Half Start", "Half End", "Tactical Shift",
    "Substitution", "Referee Ball-Drop", "Injury Stoppage",
}

FIELD_LENGTH = 120.0
FIELD_WIDTH = 80.0


def _thirds(x: float) -> str:
    if x < 40:
        return "defensive"
    if x < 80:
        return "middle"
    return "attacking"


def _safe_float(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if f != f else f  # NaN check
    except (TypeError, ValueError):
        return None


def _load_events(match_id: int) -> list[dict]:
    path = RAW / "events" / f"events_{match_id}.json"
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _encode_event(ev: dict) -> dict:
    """Extract model-ready fields from a flat statsbombpy event dict."""
    ev_type = str(ev.get("type") or "Unknown")
    play_pattern = str(ev.get("play_pattern") or "Unknown")

    loc = ev.get("location")
    x = _safe_float(loc[0] if isinstance(loc, list) and len(loc) >= 1 else None)
    y = _safe_float(loc[1] if isinstance(loc, list) and len(loc) >= 2 else None)

    # End locations differ by event type (flat statsbombpy naming)
    if ev_type == "Pass":
        end_loc = ev.get("pass_end_location")
    elif ev_type == "Carry":
        end_loc = ev.get("carry_end_location")
    elif ev_type == "Shot":
        end_loc = ev.get("shot_end_location")
    else:
        end_loc = None

    end_x = _safe_float(end_loc[0] if isinstance(end_loc, list) and len(end_loc) >= 1 else None)
    end_y = _safe_float(end_loc[1] if isinstance(end_loc, list) and len(end_loc) >= 2 else None)

    duration = _safe_float(ev.get("duration"))
    under_pressure_raw = ev.get("under_pressure")
    # statsbombpy stores as True/False/NaN
    under_pressure = 0
    if under_pressure_raw is True or under_pressure_raw == 1:
        under_pressure = 1

    return {
        "event_type": ev_type,
        "play_pattern": play_pattern,
        "minute": ev.get("minute"),
        "second": ev.get("second"),
        "x": x,
        "y": y,
        "end_x": end_x,
        "end_y": end_y,
        "duration": duration,
        "under_pressure": under_pressure,
    }


def _aggregate_possession(events: list[dict]) -> dict:
    xs = [e["x"] for e in events if e.get("x") is not None]
    n_pass = sum(1 for e in events if e["event_type"] == "Pass")
    n_carry = sum(1 for e in events if e["event_type"] == "Carry")
    n_dribble = sum(1 for e in events if e["event_type"] == "Dribble")
    n_pressure = sum(1 for e in events if e["event_type"] == "Pressure")
    n_attacking = sum(1 for e in events if e.get("x") is not None and e["x"] > 80)

    start_x = xs[0] if xs else 60.0
    end_x = xs[-1] if xs else 60.0
    progression = end_x - start_x

    durations = [e["duration"] for e in events if e.get("duration") is not None]
    total_duration = sum(durations)

    minutes = [e["minute"] for e in events if e.get("minute") is not None]
    min_minute = min(minutes) if minutes else 0

    play_pattern = events[0]["play_pattern"] if events else "Unknown"

    return {
        "n_events": len(events),
        "n_pass": n_pass,
        "n_carry": n_carry,
        "n_dribble": n_dribble,
        "n_pressure": n_pressure,
        "n_attacking_third": n_attacking,
        "start_x": start_x,
        "end_x": end_x,
        "progression": progression,
        "start_zone": _thirds(start_x),
        "end_zone": _thirds(end_x),
        "total_duration": total_duration,
        "match_minute_start": min_minute,
        "play_pattern": play_pattern,
    }


def process_match(match_id: int, competition_label: str) -> list[dict]:
    raw_events = _load_events(match_id)
    if not raw_events:
        return []

    # Group events by possession ID
    possessions: dict[int, list[dict]] = {}
    for ev in raw_events:
        pid = ev.get("possession")
        if pid is None:
            continue
        possessions.setdefault(int(pid), []).append(ev)

    records = []
    for pid, evs in sorted(possessions.items()):
        gameplay = [e for e in evs if str(e.get("type") or "") not in EXCLUDE_TYPES]
        if not gameplay:
            continue

        ends_in_shot = int(any(str(e.get("type") or "") == "Shot" for e in gameplay))

        # Exclude shot events from the input sequence to avoid leakage:
        # the task is to predict "will this possession end in a shot?"
        # from the non-shot events only. Shots are the label, not the input.
        pre_shot = [e for e in gameplay if str(e.get("type") or "") != "Shot"]
        if not pre_shot:
            pre_shot = gameplay  # possession is only shots — keep as-is

        encoded = [_encode_event(e) for e in pre_shot]
        agg = _aggregate_possession(encoded)

        records.append({
            "match_id": match_id,
            "competition_label": competition_label,
            "possession_id": pid,
            "ends_in_shot": ends_in_shot,
            "events_json": json.dumps(encoded),
            **agg,
        })

    return records


def main():
    manifest_path = RAW / "matches_manifest.csv"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Run download_statsbomb.py first. Missing: {manifest_path}")

    manifest = pd.read_csv(manifest_path)
    PROCESSED.mkdir(parents=True, exist_ok=True)

    print(f"Building possession dataset from {len(manifest)} matches...")
    all_records = []

    for _, row in tqdm(manifest.iterrows(), total=len(manifest), desc="Matches"):
        mid = int(row["match_id"])
        label = str(row.get("competition_label", "unknown"))
        all_records.extend(process_match(mid, label))

    df = pd.DataFrame(all_records)
    out = PROCESSED / "possessions.parquet"
    df.to_parquet(out, index=False)

    print(f"\nDataset saved: {out}")
    print(f"  Total possessions : {len(df):,}")
    print(f"  Shot possessions  : {df['ends_in_shot'].sum():,}  ({df['ends_in_shot'].mean():.1%})")
    print(f"  Competitions      : {df['competition_label'].value_counts().to_dict()}")
    print(f"  Matches           : {df['match_id'].nunique()}")
    return df


if __name__ == "__main__":
    main()
