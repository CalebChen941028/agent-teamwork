#!/usr/bin/env python3
"""
SWE-bench Verified Dataset Ingestion & Caching Loader for agent-teamwork.

Downloads, caches, and exports instances from the official princeton-nlp/SWE-bench_Verified
benchmark dataset (500 real-world GitHub issues across 12 prominent open-source Python repos).
Enforces clean separation between task statements and holdout evaluation patches.
"""

import argparse
import io
import json
import os
import ssl
import sys
import urllib.request
import pandas as pd

HUGGINGFACE_PARQUET_URL = (
    "https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified"
    "/resolve/main/data/test-00000-of-00001.parquet"
)

DEFAULT_CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
DEFAULT_CACHE_FILE = os.path.join(DEFAULT_CACHE_DIR, "swe-bench-verified.parquet")


def ensure_dataset(cache_path=DEFAULT_CACHE_FILE, force_download=False):
    """Downloads SWE-bench Verified parquet file if not present locally."""
    if os.path.exists(cache_path) and not force_download:
        return cache_path

    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    print(f"[*] Downloading official SWE-bench_Verified dataset (~2.1 MB) to {cache_path}...")
    ctx = ssl._create_unverified_context()
    req = urllib.request.Request(
        HUGGINGFACE_PARQUET_URL,
        headers={"User-Agent": "agent-teamwork/0.4.0 (SWE-bench-Verified-Loader)"},
    )
    with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
        data = resp.read()

    with open(cache_path, "wb") as f:
        f.write(data)

    print(f"[✔] Download complete ({len(data)} bytes). Cached at {cache_path}")
    return cache_path


def load_dataset_df(cache_path=DEFAULT_CACHE_FILE):
    """Loads dataset into a pandas DataFrame."""
    ensure_dataset(cache_path)
    return pd.read_parquet(cache_path)


def get_dataset_summary(df):
    """Returns dataset summary metrics."""
    return {
        "total_instances": len(df),
        "repos": df["repo"].value_counts().to_dict(),
        "difficulties": df["difficulty"].value_counts().to_dict() if "difficulty" in df.columns else {},
    }


def export_instances(
    df,
    out_path,
    repo=None,
    instance_id=None,
    limit=None,
    difficulty=None,
    hide_gold=True,
):
    """Filters and exports instances to JSON format for agent-teamwork runner."""
    filtered = df.copy()

    if repo:
        filtered = filtered[filtered["repo"] == repo]
    if instance_id:
        filtered = filtered[filtered["instance_id"] == instance_id]
    if difficulty and "difficulty" in filtered.columns:
        filtered = filtered[filtered["difficulty"] == difficulty]
    if limit and limit > 0:
        filtered = filtered.head(limit)

    records = []
    for _, row in filtered.iterrows():
        rec = {
            "instance_id": str(row["instance_id"]),
            "repo": str(row["repo"]),
            "base_commit": str(row["base_commit"]),
            "version": str(row.get("version", "")),
            "problem_statement": str(row["problem_statement"]),
            "hints_text": str(row.get("hints_text", "") or ""),
            "environment_setup_commit": str(row.get("environment_setup_commit", "") or ""),
            "difficulty": str(row.get("difficulty", "") or ""),
            "image": str(row.get("image", "") or ""),
        }
        if not hide_gold:
            rec["patch"] = str(row.get("patch", "") or "")
            rec["test_patch"] = str(row.get("test_patch", "") or "")
            rec["FAIL_TO_PASS"] = json.loads(str(row["FAIL_TO_PASS"])) if row.get("FAIL_TO_PASS") else []
            rec["PASS_TO_PASS"] = json.loads(str(row["PASS_TO_PASS"])) if row.get("PASS_TO_PASS") else []

        records.append(rec)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    print(f"[✔] Exported {len(records)} instances to {out_path} (hide_gold={hide_gold})")
    return records


def main():
    parser = argparse.ArgumentParser(description="SWE-bench Verified Ingestion Loader")
    parser.add_argument("--info", action="store_true", help="Print dataset summary metrics")
    parser.add_argument("--cache-file", default=DEFAULT_CACHE_FILE, help="Path to cached parquet file")
    parser.add_argument("--force-download", action="store_true", help="Force re-download from HuggingFace")
    parser.add_argument("--export", help="Output path to export instances as JSON")
    parser.add_argument("--repo", help="Filter by repository name (e.g. psf/requests, django/django)")
    parser.add_argument("--instance", help="Filter by specific instance_id")
    parser.add_argument("--difficulty", help="Filter by difficulty level (e.g. easy, medium, hard)")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of exported instances")
    parser.add_argument("--include-gold", action="store_true", help="Include gold patch and secret tests in export")

    args = parser.parse_args()

    if args.force_download:
        ensure_dataset(args.cache_file, force_download=True)

    df = load_dataset_df(args.cache_file)

    if args.info:
        summary = get_dataset_summary(df)
        print("=== SWE-bench Verified Dataset Summary ===")
        print(f"Total Verified Instances: {summary['total_instances']}")
        print("\nRepositories:")
        for r, count in summary["repos"].items():
            print(f"  • {r:<25}: {count:>3} issues")
        if summary["difficulties"]:
            print("\nDifficulty Breakdown:")
            for d, count in summary["difficulties"].items():
                print(f"  • {d:<15}: {count:>3} issues")
        return

    if args.export:
        export_instances(
            df=df,
            out_path=args.export,
            repo=args.repo,
            instance_id=args.instance,
            limit=args.limit,
            difficulty=args.difficulty,
            hide_gold=not args.include_gold,
        )
    else:
        print("No action specified. Use --info to view summary or --export <file.json> to export tasks.")


if __name__ == "__main__":
    main()
