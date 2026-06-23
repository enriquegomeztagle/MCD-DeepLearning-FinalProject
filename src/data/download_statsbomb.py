"""
Download StatsBomb open data for the selected competition/season pairs and cache locally.

Selected competitions:
  - 1. Bundesliga 2023/2024  (competition_id=9,  season_id=281)
  - La Liga 2020/2021         (competition_id=11, season_id=90)
  - Ligue 1 2021/2022        (competition_id=7,  season_id=108)
  - Ligue 1 2022/2023        (competition_id=7,  season_id=235)
"""

import json
import os
import time
from pathlib import Path

import pandas as pd
from statsbombpy import sb
from tqdm import tqdm

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "statsbomb"

COMPETITIONS = [
    {"competition_id": 9,  "season_id": 281, "label": "Bundesliga_2324"},
    {"competition_id": 11, "season_id": 90,  "label": "LaLiga_2021"},
    {"competition_id": 7,  "season_id": 108, "label": "Ligue1_2122"},
    {"competition_id": 7,  "season_id": 235, "label": "Ligue1_2223"},
]


def _save_json(data, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def download_competitions():
    out = RAW / "competitions.json"
    if out.exists():
        print("competitions.json already cached")
        return
    comps = sb.competitions()
    comps.to_json(out, orient="records", indent=2)
    print(f"Saved competitions -> {out}")


def download_matches_for_competition(competition_id: int, season_id: int, label: str):
    out = RAW / "matches" / f"matches_{competition_id}_{season_id}.json"
    if out.exists():
        print(f"  matches {label} already cached")
        matches = pd.read_json(out)
        return matches

    matches = sb.matches(competition_id=competition_id, season_id=season_id)
    matches.to_json(out, orient="records", indent=2)
    print(f"  Saved {len(matches)} matches for {label} -> {out}")
    return matches


def download_events_for_match(match_id: int, force: bool = False):
    out = RAW / "events" / f"events_{match_id}.json"
    if out.exists() and not force:
        return False  # already cached
    events = sb.events(match_id=match_id)
    _save_json(events.to_dict(orient="records"), out)
    return True


def download_three_sixty_for_match(match_id: int, force: bool = False):
    out = RAW / "three_sixty" / f"three_sixty_{match_id}.json"
    if out.exists() and not force:
        return False
    try:
        frames = sb.frames(match_id=match_id)
        _save_json(frames.to_dict(orient="records"), out)
        return True
    except Exception:
        # Not all matches have 360 data; write empty file to avoid re-fetching
        _save_json([], out)
        return False


def build_manifest(all_matches: list[pd.DataFrame]) -> pd.DataFrame:
    combined = pd.concat(all_matches, ignore_index=True)
    needed = ["match_id", "competition", "season", "home_team", "away_team", "match_date"]
    cols = [c for c in needed if c in combined.columns]
    manifest = combined[cols].copy()

    # Flatten nested dicts that statsbombpy returns
    if "competition" in manifest.columns and manifest["competition"].dtype == object:
        try:
            comp_df = pd.json_normalize(manifest["competition"].tolist())
            manifest["competition_name"] = comp_df.get("competition_name", comp_df.iloc[:, 0])
            manifest = manifest.drop(columns=["competition"])
        except Exception:
            pass

    if "season" in manifest.columns and manifest["season"].dtype == object:
        try:
            season_df = pd.json_normalize(manifest["season"].tolist())
            manifest["season_name"] = season_df.get("season_name", season_df.iloc[:, 0])
            manifest = manifest.drop(columns=["season"])
        except Exception:
            pass

    if "home_team" in manifest.columns and manifest["home_team"].dtype == object:
        try:
            ht = pd.json_normalize(manifest["home_team"].tolist())
            manifest["home_team"] = ht.get("home_team_name", ht.iloc[:, 0])
        except Exception:
            pass

    if "away_team" in manifest.columns and manifest["away_team"].dtype == object:
        try:
            at = pd.json_normalize(manifest["away_team"].tolist())
            manifest["away_team"] = at.get("away_team_name", at.iloc[:, 0])
        except Exception:
            pass

    # Add competition tags from COMPETITIONS lookup
    comp_map = {(c["competition_id"], c["season_id"]): c["label"] for c in COMPETITIONS}
    # Re-merge on competition_id/season_id from original
    merged = pd.concat(all_matches, ignore_index=True)
    if "competition_id" not in merged.columns and "competition" in merged.columns:
        try:
            comp_df2 = pd.json_normalize(merged["competition"].tolist())
            merged["competition_id"] = comp_df2["competition_id"].values
            merged["season_id"] = comp_df2["season_id"].values
        except Exception:
            pass

    if "competition_id" in merged.columns and "season_id" in merged.columns:
        manifest["competition_id"] = merged["competition_id"].values
        manifest["season_id"] = merged["season_id"].values
        manifest["competition_label"] = manifest.apply(
            lambda r: comp_map.get((int(r["competition_id"]), int(r["season_id"])), "unknown"),
            axis=1,
        )

    return manifest


def main():
    print("=== StatsBomb Data Downloader ===")
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "events").mkdir(exist_ok=True)
    (RAW / "three_sixty").mkdir(exist_ok=True)
    (RAW / "matches").mkdir(exist_ok=True)

    download_competitions()

    all_matches = []
    for comp in COMPETITIONS:
        print(f"\nFetching matches: {comp['label']}")
        matches = download_matches_for_competition(
            comp["competition_id"], comp["season_id"], comp["label"]
        )
        all_matches.append(matches)

    # Build and save manifest
    manifest = build_manifest(all_matches)
    manifest_path = RAW / "matches_manifest.csv"
    manifest.to_csv(manifest_path, index=False)
    print(f"\nManifest saved: {manifest_path}  ({len(manifest)} matches)")

    # Download events for each match
    match_ids = manifest["match_id"].tolist()
    print(f"\nDownloading events for {len(match_ids)} matches...")
    new_events = 0
    for mid in tqdm(match_ids, desc="Events"):
        if download_events_for_match(int(mid)):
            new_events += 1
            time.sleep(0.05)  # be polite to the API
    print(f"  {new_events} new event files, {len(match_ids) - new_events} already cached")

    print("\nDownloading 360 frames (may fail for matches without 360 data)...")
    new_360 = 0
    for mid in tqdm(match_ids, desc="360 frames"):
        if download_three_sixty_for_match(int(mid)):
            new_360 += 1
            time.sleep(0.05)
    print(f"  {new_360} new 360 files")

    print("\nDone. Data stored under:", RAW)


if __name__ == "__main__":
    main()
