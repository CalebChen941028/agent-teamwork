#!/usr/bin/env bash
# Sync shared modules from agent-boost to agent-teamwork
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$SCRIPT_DIR/../shared"
SOURCE_DIR="$SCRIPT_DIR/../../agent-boost/shared"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Error: source directory $SOURCE_DIR not found." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cp -r "$SOURCE_DIR"/* "$TARGET_DIR"/

echo "Successfully synchronized shared/ from agent-boost."
