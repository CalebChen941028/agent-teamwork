#!/usr/bin/env bash
# Unified multi-agent installer for agent-teamwork
# Supports: all | zcode | claude | codex | antigravity | agents | deepseek | opencode | workbuddy | cursor | windsurf | cline | aider | generic
set -euo pipefail

TARGET="zcode"
LANG_OPT="auto"
DRY_RUN=false
DEST=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(cat "$SCRIPT_DIR/VERSION" 2>/dev/null || echo "0.6.3")"

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
      echo "Usage: $0 [--target all|zcode|claude|codex|antigravity|agents|deepseek|opencode|workbuddy|cursor|windsurf|cline|aider|generic] [--lang auto|zh|en] [--dry-run] [--dest <path>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$LANG_OPT" == "auto" ]]; then
  SYS_LOCALE="${LC_ALL:-${LANG:-en}}"
  if [[ "$SYS_LOCALE" == zh* || "$SYS_LOCALE" == *CN* || "$SYS_LOCALE" == *TW* || "$SYS_LOCALE" == *HK* ]]; then
    LANG_OPT="zh"
  else
    LANG_OPT="en"
  fi
fi

if [[ "$LANG_OPT" != "zh" && "$LANG_OPT" != "en" ]]; then
  echo "Unsupported language: $LANG_OPT (expected auto, zh, or en)" >&2
  exit 1
fi

MANIFEST_DIR="$HOME/.local/share/agent-teamwork"
MANIFEST_FILE="$MANIFEST_DIR/install-manifest-${TARGET}.json"
LEGACY_MANIFEST_FILE="$MANIFEST_DIR/install-manifest.json"

if [[ "$TARGET" == "all" ]]; then
  DETECTED_TARGETS=()
  [[ -d "$HOME/.zcode" ]] && DETECTED_TARGETS+=("zcode")
  [[ -d "$HOME/.claude" ]] && DETECTED_TARGETS+=("claude")
  [[ -d "$HOME/.codex" ]] && DETECTED_TARGETS+=("codex")
  [[ -d "$HOME/.dsh" || -d "$HOME/.deepseek" ]] && DETECTED_TARGETS+=("deepseek")
  [[ -d "$HOME/.agents" ]] && DETECTED_TARGETS+=("agents")
  [[ -d "$HOME/.gemini" ]] && DETECTED_TARGETS+=("antigravity")
  [[ -d "$HOME/.opencode" ]] && DETECTED_TARGETS+=("opencode")
  [[ -d "$HOME/.workbuddy" ]] && DETECTED_TARGETS+=("workbuddy")
  [[ -d "$HOME/.cursor" ]] && DETECTED_TARGETS+=("cursor")
  [[ -d "$HOME/.windsurf" ]] && DETECTED_TARGETS+=("windsurf")

  if [[ ${#DETECTED_TARGETS[@]} -eq 0 ]]; then
    DETECTED_TARGETS=("zcode" "claude" "codex" "agents")
  fi

  echo "==> Multi-Agent Batch Installation: Found ${#DETECTED_TARGETS[@]} target(s): ${DETECTED_TARGETS[*]}"
  for t in "${DETECTED_TARGETS[@]}"; do
    echo ""
    echo "--- Installing for target: $t ---"
    "$0" --target "$t" --lang "$LANG_OPT" $([[ "$DRY_RUN" == true ]] && echo "--dry-run")
  done
  echo ""
  echo "All ${#DETECTED_TARGETS[@]} targets processed successfully."
  exit 0
fi

case "$TARGET" in
  zcode)
    BASE_DEST="${DEST:-$HOME/.zcode}"
    WORKFLOW_DEST="$BASE_DEST/workflows"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  claude|claude-code)
    TARGET="claude"
    BASE_DEST="${DEST:-$HOME/.claude}"
    WORKFLOW_DEST="$BASE_DEST/commands"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    MANIFEST_FILE="$MANIFEST_DIR/install-manifest-claude.json"
    ;;
  codex)
    BASE_DEST="${DEST:-$HOME/.codex}"
    WORKFLOW_DEST="$BASE_DEST/workflows"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  antigravity|gemini)
    TARGET="antigravity"
    BASE_DEST="${DEST:-$HOME/.gemini/antigravity}"
    WORKFLOW_DEST="$BASE_DEST/skills/teamwork"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    MANIFEST_FILE="$MANIFEST_DIR/install-manifest-antigravity.json"
    ;;
  agents)
    TARGET="agents"
    BASE_DEST="${DEST:-$HOME/.agents}"
    WORKFLOW_DEST="$BASE_DEST/skills/teamwork"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    MANIFEST_FILE="$MANIFEST_DIR/install-manifest-agents.json"
    ;;
  deepseek|dsh)
    TARGET="deepseek"
    if [[ -n "$DEST" ]]; then
      BASE_DEST="$DEST"
    elif [[ -d "$HOME/.dsh" ]]; then
      BASE_DEST="$HOME/.dsh"
    else
      BASE_DEST="$HOME/.deepseek"
    fi
    WORKFLOW_DEST="$BASE_DEST/workflows"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    MANIFEST_FILE="$MANIFEST_DIR/install-manifest-deepseek.json"
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
  cursor)
    BASE_DEST="${DEST:-$HOME/.cursor}"
    WORKFLOW_DEST="$BASE_DEST/rules"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  windsurf)
    BASE_DEST="${DEST:-$HOME/.windsurf}"
    WORKFLOW_DEST="$BASE_DEST/rules"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  cline|aider|generic)
    BASE_DEST="${DEST:-$HOME/.agent-teamwork}"
    WORKFLOW_DEST="$BASE_DEST/workflows"
    SKILL_DEST="$BASE_DEST/skills/teamwork"
    ;;
  *)
    echo "Unsupported target: $TARGET (expected: all, zcode, claude, codex, antigravity, agents, deepseek, opencode, workbuddy, cursor, windsurf, cline, aider, generic)" >&2
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

TIMESTAMP="$(date +%Y%m%d%H%M%S)_$$"

mkdir -p "$WORKFLOW_DEST" "$SKILL_DEST/protocol" "$SKILL_DEST/roles"

INSTALLED_FILES=()

backup_and_copy() {
  local src="$1"
  local dst="$2"
  if [[ -f "$dst" ]] && ! cmp -s "$src" "$dst"; then
    cp "$dst" "${dst}.bak-$TIMESTAMP"
  fi
  cp "$src" "$dst"
  INSTALLED_FILES+=("$dst")
}

# 1. Install skill, protocol docs, and bilingual role definitions into SKILL_DEST
backup_and_copy "$SCRIPT_DIR/skills/teamwork/SKILL.md" "$SKILL_DEST/SKILL.md"
backup_and_copy "$SCRIPT_DIR/protocol/scoping-interview.md" "$SKILL_DEST/protocol/scoping-interview.md"
backup_and_copy "$SCRIPT_DIR/protocol/teamwork.md" "$SKILL_DEST/protocol/teamwork.md"

for role_file in "$SCRIPT_DIR"/roles/*.md; do
  if [[ -f "$role_file" ]]; then
    base_name="$(basename "$role_file")"
    backup_and_copy "$role_file" "$SKILL_DEST/roles/$base_name"
  fi
done

echo "Installed skill, protocol, and bilingual role prompts to $SKILL_DEST"

# 2. Install target workflow/adapter
if [[ "$TARGET" == "zcode" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/zcode/teamwork.dwf.ts" "$WORKFLOW_DEST/teamwork.dwf.ts"
  echo "Installed ZCode workflow to $WORKFLOW_DEST/teamwork.dwf.ts"
elif [[ "$TARGET" == "claude" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/claude-code/teamwork.md" "$WORKFLOW_DEST/teamwork.md"
  echo "Installed Claude Code command protocol to $WORKFLOW_DEST/teamwork.md"
elif [[ "$TARGET" == "codex" ]]; then
  # Skill-scoped filename: other Codex skill packs share the same workflows directory,
  # so a generic "protocol.md" would silently overwrite them (and vice versa).
  backup_and_copy "$SCRIPT_DIR/adapters/codex/protocol.md" "$WORKFLOW_DEST/teamwork.protocol.md"
  backup_and_copy "$SCRIPT_DIR/adapters/codex/protocol.md" "$WORKFLOW_DEST/teamwork.md"
  # Migrate legacy installs: drop the ambiguous protocol.md only when it is byte-identical
  # to this adapter, i.e. the file content is already preserved under the scoped name.
  if [[ -f "$WORKFLOW_DEST/protocol.md" ]] && cmp -s "$SCRIPT_DIR/adapters/codex/protocol.md" "$WORKFLOW_DEST/protocol.md"; then
    rm "$WORKFLOW_DEST/protocol.md"
    echo "Removed legacy ambiguous $WORKFLOW_DEST/protocol.md (content now in teamwork.protocol.md)"
  fi
  echo "Installed Codex protocol to $WORKFLOW_DEST/teamwork.protocol.md and $WORKFLOW_DEST/teamwork.md"
elif [[ "$TARGET" == "deepseek" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/deepseek/teamwork.md" "$WORKFLOW_DEST/teamwork.md"
  echo "Installed DeepSeek protocol to $WORKFLOW_DEST/teamwork.md"
elif [[ "$TARGET" == "opencode" ]]; then
  mkdir -p "$WORKFLOW_DEST/roles"
  for role_file in "$SCRIPT_DIR"/roles/*."${LANG_OPT}".md; do
    if [[ -f "$role_file" ]]; then
      base_name="$(basename "$role_file")"
      backup_and_copy "$role_file" "$WORKFLOW_DEST/roles/$base_name"
    fi
  done
  if [[ -f "$WORKFLOW_DEST/agents.json" ]]; then
    cp "$WORKFLOW_DEST/agents.json" "$WORKFLOW_DEST/agents.json.bak-$TIMESTAMP"
  fi
  sed "s/\.en\.md/.${LANG_OPT}.md/g" "$SCRIPT_DIR/adapters/opencode/agents.json" > "$WORKFLOW_DEST/agents.json"
  INSTALLED_FILES+=("$WORKFLOW_DEST/agents.json")
  echo "Installed OpenCode agents configuration (lang: $LANG_OPT) and role prompts to $WORKFLOW_DEST"
elif [[ "$TARGET" == "antigravity" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/generic/teamwork.md" "$WORKFLOW_DEST/teamwork.md"
  mkdir -p "$BASE_DEST/workflows"
  backup_and_copy "$SCRIPT_DIR/adapters/generic/teamwork.md" "$BASE_DEST/workflows/teamwork.md"
  echo "Installed Antigravity teamwork protocol to $WORKFLOW_DEST/teamwork.md and $BASE_DEST/workflows/teamwork.md"
  if [[ -z "$DEST" && "$SKILL_DEST" != "$HOME/.gemini/config/skills/teamwork" ]]; then
    GEMINI_CONFIG_SKILL="$HOME/.gemini/config/skills/teamwork"
    mkdir -p "$GEMINI_CONFIG_SKILL/protocol" "$GEMINI_CONFIG_SKILL/roles"
    backup_and_copy "$SCRIPT_DIR/skills/teamwork/SKILL.md" "$GEMINI_CONFIG_SKILL/SKILL.md"
    backup_and_copy "$SCRIPT_DIR/protocol/scoping-interview.md" "$GEMINI_CONFIG_SKILL/protocol/scoping-interview.md"
    backup_and_copy "$SCRIPT_DIR/protocol/teamwork.md" "$GEMINI_CONFIG_SKILL/protocol/teamwork.md"
    for role_file in "$SCRIPT_DIR"/roles/*.md; do
      if [[ -f "$role_file" ]]; then
        base_name="$(basename "$role_file")"
        backup_and_copy "$role_file" "$GEMINI_CONFIG_SKILL/roles/$base_name"
      fi
    done
    echo "Also mirrored teamwork skill to $GEMINI_CONFIG_SKILL"
  fi
elif [[ "$TARGET" == "agents" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/generic/teamwork.md" "$WORKFLOW_DEST/teamwork.md"
  mkdir -p "$BASE_DEST/workflows"
  backup_and_copy "$SCRIPT_DIR/adapters/generic/teamwork.md" "$BASE_DEST/workflows/teamwork.md"
  echo "Installed universal agents teamwork protocol to $WORKFLOW_DEST/teamwork.md and $BASE_DEST/workflows/teamwork.md"
elif [[ "$TARGET" == "workbuddy" ]]; then
  backup_and_copy "$SCRIPT_DIR/adapters/workbuddy/teamwork.md" "$WORKFLOW_DEST/teamwork.md"
  echo "Installed WorkBuddy protocol to $WORKFLOW_DEST/teamwork.md"
else
  backup_and_copy "$SCRIPT_DIR/adapters/generic/teamwork.md" "$WORKFLOW_DEST/teamwork.md"
  echo "Installed generic protocol ($TARGET) to $WORKFLOW_DEST/teamwork.md"
fi

# 3. Record per-target manifest and legacy manifest using Node.js
mkdir -p "$MANIFEST_DIR"
printf '%s\n' "${INSTALLED_FILES[@]}" | node -e '
const fs = require("node:fs");
const manifestFile = process.argv[1];
const legacyFile = process.argv[2];
const version = process.argv[3];
const target = process.argv[4];
const lang = process.argv[5];
const ts = process.argv[6];
const newFiles = Array.from(new Set(fs.readFileSync(0, "utf8").split("\n").map(s => s.trim()).filter(Boolean)));

const payload = {
  version,
  target,
  lang,
  installed_at: new Date().toISOString(),
  files: newFiles,
  backup_timestamp: ts,
};
const serialized = JSON.stringify(payload, null, 2) + "\n";
fs.writeFileSync(manifestFile, serialized, "utf8");
fs.writeFileSync(legacyFile, serialized, "utf8");
' "$MANIFEST_FILE" "$LEGACY_MANIFEST_FILE" "$VERSION" "$TARGET" "$LANG_OPT" "$TIMESTAMP"

echo "Installation complete. Manifest saved to $MANIFEST_FILE."
