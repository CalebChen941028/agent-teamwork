#!/usr/bin/env bash
# Unified installer for agent-teamwork
# Supports: zcode | claude | codex | deepseek | opencode | workbuddy | generic
set -euo pipefail

TARGET="zcode"
LANG_OPT="zh"
DRY_RUN=false
DEST=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(cat "$SCRIPT_DIR/VERSION" 2>/dev/null || echo "0.2.0")"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="$2"
      shift 2
      ;;
    --lang)
      LANG_OPT="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --dest)
      DEST="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--target zcode|claude|codex|deepseek|opencode|workbuddy|generic] [--lang zh|en] [--dry-run] [--dest <path>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$LANG_OPT" != "zh" && "$LANG_OPT" != "en" ]]; then
  echo "Unsupported language: $LANG_OPT (expected zh or en)" >&2
  exit 1
fi

MANIFEST_DIR="$HOME/.local/share/agent-teamwork"
MANIFEST_FILE="$MANIFEST_DIR/install-manifest.json"

case "$TARGET" in
  zcode)
    BASE_DEST="${DEST:-$HOME/.zcode}"
    WORKFLOW_DEST="$BASE_DEST/workflows"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  claude)
    BASE_DEST="${DEST:-$HOME/.claude}"
    WORKFLOW_DEST="$BASE_DEST/commands"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  codex)
    BASE_DEST="${DEST:-$HOME/.codex}"
    WORKFLOW_DEST="$BASE_DEST/workflows"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  deepseek)
    BASE_DEST="${DEST:-$HOME/.deepseek}"
    WORKFLOW_DEST="$BASE_DEST/workflows"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  opencode)
    BASE_DEST="${DEST:-$HOME/.opencode}"
    WORKFLOW_DEST="$BASE_DEST/workflows"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  workbuddy)
    BASE_DEST="${DEST:-$HOME/.workbuddy}"
    WORKFLOW_DEST="$BASE_DEST/workflows"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  generic)
    BASE_DEST="${DEST:-$HOME/.agent-teamwork}"
    WORKFLOW_DEST="$BASE_DEST/workflows"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  *)
    echo "Unsupported target: $TARGET (expected: zcode, claude, codex, deepseek, opencode, workbuddy, generic)" >&2
    exit 1
    ;;
esac

echo "Target platform:      $TARGET (lang: $LANG_OPT)"
echo "Workflow destination: $WORKFLOW_DEST"
echo "Skill destination:    $SKILL_DEST"

if [[ "$DRY_RUN" == true ]]; then
  echo "[Dry-Run] Target: $TARGET ($LANG_OPT)"
  echo "[Dry-Run] Would copy $SCRIPT_DIR/skills/teamwork/SKILL.md -> $SKILL_DEST/SKILL.md"
  echo "[Dry-Run] Would copy $SCRIPT_DIR/protocol/*.md -> $SKILL_DEST/protocol/"
  echo "[Dry-Run] Would copy $SCRIPT_DIR/roles/*.${LANG_OPT}.md -> $SKILL_DEST/roles/"
  echo "[Dry-Run] Would install workflow/adapter into $WORKFLOW_DEST"
  exit 0
fi

TIMESTAMP="$(date +%Y%m%d%H%M%S)"

mkdir -p "$WORKFLOW_DEST" "$SKILL_DEST/protocol" "$SKILL_DEST/roles"

INSTALLED_FILES=()

backup_and_copy() {
  local src="$1"
  local dst="$2"
  if [[ -f "$dst" ]]; then
    cp "$dst" "${dst}.bak-$TIMESTAMP"
  fi
  cp "$src" "$dst"
  INSTALLED_FILES+=("$dst")
}

# 1. Install skill and protocol docs
backup_and_copy "$SCRIPT_DIR/skills/teamwork/SKILL.md" "$SKILL_DEST/SKILL.md"
backup_and_copy "$SCRIPT_DIR/protocol/scoping-interview.md" "$SKILL_DEST/protocol/scoping-interview.md"
backup_and_copy "$SCRIPT_DIR/protocol/teamwork.md" "$SKILL_DEST/protocol/teamwork.md"

# 2. Install language-specific role definitions
for role_file in "$SCRIPT_DIR/roles/"*."${LANG_OPT}.md"; do
  if [[ -f "$role_file" ]]; then
    base_name="$(basename "$role_file")"
    backup_and_copy "$role_file" "$SKILL_DEST/roles/$base_name"
  fi
done

echo "Installed skill, protocol, and ${LANG_OPT} roles to $SKILL_DEST"

# 3. Install target workflow/adapter
if [[ "$TARGET" == "zcode" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/zcode/teamwork.dwf.ts" "$WORKFLOW_DEST/teamwork.dwf.ts"
  echo "Installed ZCode workflow to $WORKFLOW_DEST/teamwork.dwf.ts"
elif [[ "$TARGET" == "claude" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/claude-code/teamwork.md" "$WORKFLOW_DEST/teamwork.md"
  echo "Installed Claude Code command protocol to $WORKFLOW_DEST/teamwork.md"
elif [[ "$TARGET" == "codex" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/codex/protocol.md" "$WORKFLOW_DEST/protocol.md"
  echo "Installed Codex protocol to $WORKFLOW_DEST/protocol.md"
elif [[ "$TARGET" == "deepseek" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/deepseek/teamwork.md" "$WORKFLOW_DEST/teamwork.md"
  echo "Installed DeepSeek protocol to $WORKFLOW_DEST/teamwork.md"
elif [[ "$TARGET" == "opencode" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/opencode/agents.json" "$WORKFLOW_DEST/agents.json"
  echo "Installed OpenCode agents configuration to $WORKFLOW_DEST/agents.json"
elif [[ "$TARGET" == "workbuddy" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/workbuddy/teamwork.md" "$WORKFLOW_DEST/teamwork.md"
  echo "Installed WorkBuddy protocol to $WORKFLOW_DEST/teamwork.md"
else
  backup_and_copy "$SCRIPT_DIR/adapters/generic/teamwork.md" "$WORKFLOW_DEST/teamwork.md"
  echo "Installed generic protocol to $WORKFLOW_DEST/teamwork.md"
fi

# 4. Record manifest using Node.js (merges existing files if installed across multiple targets)
mkdir -p "$MANIFEST_DIR"
printf '%s\n' "${INSTALLED_FILES[@]}" | node -e '
const fs = require("node:fs");
const manifestFile = process.argv[1];
const version = process.argv[2];
const target = process.argv[3];
const lang = process.argv[4];
const ts = process.argv[5];
const newFiles = fs.readFileSync(0, "utf8").split("\n").map(s => s.trim()).filter(Boolean);

let existing = { files: [] };
if (fs.existsSync(manifestFile)) {
  try { existing = JSON.parse(fs.readFileSync(manifestFile, "utf8")); } catch {}
}
const mergedFiles = Array.from(new Set([...(existing.files || []), ...newFiles]));
const payload = {
  version,
  target,
  lang,
  installed_at: new Date().toISOString(),
  files: mergedFiles,
  backup_timestamp: ts,
};
fs.writeFileSync(manifestFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
' "$MANIFEST_FILE" "$VERSION" "$TARGET" "$LANG_OPT" "$TIMESTAMP"

echo "Installation complete. Manifest saved to $MANIFEST_FILE."
