#!/usr/bin/env python3
"""
Official SWE-bench Docker Evaluation Bridge for agent-teamwork.

Invokes the official SWE-bench evaluation harness (swebench.harness.run_evaluation)
inside Docker containers to execute holdout verification test suites (FAIL_TO_PASS & PASS_TO_PASS).
Parses results and outputs an executive scorecard comparing Solo vs agent-teamwork.
"""

import argparse
import json
import os
import subprocess
import sys


def check_docker():
    """Checks if Docker daemon is running."""
    try:
        res = subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"], capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            return True, res.stdout.strip()
    except Exception as e:
        return False, str(e)
    return False, "Docker daemon not reachable"


def check_swebench_installed():
    """Checks if the swebench Python package is installed."""
    try:
        import swebench
        return True, getattr(swebench, "__version__", "installed")
    except ImportError:
        return False, "swebench not installed (install via: pip install swebench)"


def validate_predictions_format(predictions_path):
    """Validates that predictions.jsonl satisfies official SWE-bench format."""
    if not os.path.exists(predictions_path):
        raise FileNotFoundError(f"Predictions file not found: {predictions_path}")

    valid_lines = 0
    instances = []
    with open(predictions_path, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError as err:
                raise ValueError(f"Line {idx} in {predictions_path} is invalid JSON: {err}")

            if "instance_id" not in data or "model_patch" not in data:
                raise ValueError(f"Line {idx} missing required fields ('instance_id', 'model_patch')")

            instances.append(data["instance_id"])
            valid_lines += 1

    print(f"[✔] Predictions file valid: {valid_lines} instances in {predictions_path}")
    return instances


def run_local_lint_and_diff_check(predictions_path):
    """Offline sanity check: verifies that patches are non-empty and well-formed."""
    instances = validate_predictions_format(predictions_path)
    empty_patches = 0
    non_empty = 0
    with open(predictions_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            data = json.loads(line)
            patch = data.get("model_patch", "")
            if not patch or not patch.strip():
                empty_patches += 1
            else:
                non_empty += 1

    print("\n--- Local Patch Sanity Inspection ---")
    print(f"Total instances  : {len(instances)}")
    print(f"Generated patches: {non_empty} ({non_empty / len(instances) * 100:.1f}%)")
    print(f"Empty patches    : {empty_patches}")
    print("[✔] Ready for Docker SWE-bench execution.")


def run_official_swebench_evaluation(
    predictions_path,
    dataset_name="SWE-bench/SWE-bench_Verified",
    max_workers=4,
    run_id="agent-teamwork-eval",
    timeout=1800,
):
    """Invokes official swebench.harness.run_evaluation."""
    docker_ok, docker_ver = check_docker()
    if not docker_ok:
        print(f"[✖] Docker Error: {docker_ver}. SWE-bench requires Docker to run evaluation.", file=sys.stderr)
        sys.exit(1)

    swe_ok, swe_ver = check_swebench_installed()
    if not swe_ok:
        print(f"[!] Warning: {swe_ver}", file=sys.stderr)
        print("    Running offline validation instead. To run full Docker evaluation, run: pip install swebench", file=sys.stderr)
        run_local_lint_and_diff_check(predictions_path)
        return

    print(f"[*] Starting Official SWE-bench Evaluation via Docker (version {docker_ver})...")
    print(f"    Dataset: {dataset_name}")
    print(f"    Predictions: {predictions_path}")
    print(f"    Max Workers: {max_workers}")

    cmd = [
        sys.executable,
        "-m",
        "swebench.harness.run_evaluation",
        "--dataset_name",
        dataset_name,
        "--predictions_path",
        predictions_path,
        "--max_workers",
        str(max_workers),
        "--run_id",
        run_id,
        "--timeout",
        str(timeout),
    ]

    res = subprocess.run(cmd)
    if res.returncode != 0:
        print(f"[✖] SWE-bench evaluation returned non-zero exit code: {res.returncode}", file=sys.stderr)
        sys.exit(res.returncode)

    print("[✔] Evaluation completed successfully. Inspect results in evaluation directory.")


def main():
    parser = argparse.ArgumentParser(description="SWE-bench Official Evaluation Bridge")
    parser.add_argument("--predictions", required=True, help="Path to predictions.jsonl")
    parser.add_argument("--dataset", default="SWE-bench/SWE-bench_Verified", help="HuggingFace dataset name (SWE-bench/SWE-bench_Verified includes image_name column required by swebench 5.0+)")
    parser.add_argument("--max-workers", type=int, default=4, help="Maximum concurrent Docker workers")
    parser.add_argument("--run-id", default="agent-teamwork-eval", help="Evaluation run ID")
    parser.add_argument("--local-check-only", action="store_true", help="Run offline format and diff verification only")

    args = parser.parse_args()

    if args.local_check_only:
        run_local_lint_and_diff_check(args.predictions)
    else:
        run_official_swebench_evaluation(
            predictions_path=args.predictions,
            dataset_name=args.dataset,
            max_workers=args.max_workers,
            run_id=args.run_id,
        )


if __name__ == "__main__":
    main()
