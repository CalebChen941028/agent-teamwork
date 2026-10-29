#!/usr/bin/env bash
# Uninstaller for agent-teamwork
set -euo pipefail

TARGET=""
PURGE_BACKUPS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="$2"
      shift 2
      ;;
    --purge-backups)
      PURGE_BACKUPS=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--target all|zcode|claude|codex|antigravity|agents|opencode|deepseek|workbuddy|cursor|windsurf|cline|aider|generic] [--purge-backups]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

case "$TARGET" in
  claude-code) TARGET="claude" ;;
  gemini) TARGET="antigravity" ;;
  dsh) TARGET="deepseek" ;;
  all) TARGET="" ;;
esac

MANIFEST_DIR="$HOME/.local/share/agent-teamwork"

if [[ -n "$TARGET" ]]; then
  MANIFEST_FILES=("$MANIFEST_DIR/install-manifest-${TARGET}.json")
else
  shopt -s nullglob
  MANIFEST_FILES=("$MANIFEST_DIR"/install-manifest-*.json)
  shopt -u nullglob
  if [[ ${#MANIFEST_FILES[@]} -eq 0 && -f "$MANIFEST_DIR/install-manifest.json" ]]; then
    MANIFEST_FILES=("$MANIFEST_DIR/install-manifest.json")
  fi
fi

if [[ ${#MANIFEST_FILES[@]} -eq 0 || ! -f "${MANIFEST_FILES[0]}" ]]; then
  echo "No manifest file found in $MANIFEST_DIR. Nothing to uninstall."
  exit 0
fi

for mf in "${MANIFEST_FILES[@]}"; do
  [[ -f "$mf" ]] || continue
  node - "$mf" "$PURGE_BACKUPS" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.resolve(process.argv[2]);
const purgeBackups = String(process.argv[3]).toLowerCase() === "true";
const manifestDir = path.dirname(manifestPath);

const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const ts = data.backup_timestamp || "";

// Collect active files from all other per-target manifests
const dirEntries = fs.existsSync(manifestDir) ? fs.readdirSync(manifestDir) : [];
const otherManifests = dirEntries
  .filter((name) => /^install-manifest-.*\.json$/.test(name))
  .map((name) => path.resolve(manifestDir, name))
  .filter((fullPath) => fullPath !== manifestPath && fs.existsSync(fullPath));

const legacyManifest = path.resolve(manifestDir, "install-manifest.json");
if (fs.existsSync(legacyManifest) && legacyManifest !== manifestPath) {
  try {
    const legData = JSON.parse(fs.readFileSync(legacyManifest, "utf8"));
    if (legData.target === data.target) {
      fs.unlinkSync(legacyManifest);
    } else {
      otherManifests.push(legacyManifest);
    }
  } catch {}
}

const activeFilesInOtherManifests = new Set();
for (const om of otherManifests) {
  try {
    const omData = JSON.parse(fs.readFileSync(om, "utf8"));
    for (const filePath of omData.files || []) {
      activeFilesInOtherManifests.add(path.resolve(filePath));
    }
  } catch {}
}

for (const f of data.files || []) {
  const resolvedFp = path.resolve(f);
  if (activeFilesInOtherManifests.has(resolvedFp)) {
    console.log(`Retained shared file: ${f} (in use by another target)`);
    continue;
  }

  const bak = ts ? `${f}.bak-${ts}` : "";
  if (bak && fs.existsSync(bak)) {
    fs.renameSync(bak, f);
    console.log(`Restored: ${f} from backup`);
  } else if (fs.existsSync(f)) {
    fs.unlinkSync(f);
    console.log(`Removed: ${f}`);
  }

  if (purgeBackups) {
    const parentDir = path.dirname(f);
    const baseName = path.basename(f);
    if (fs.existsSync(parentDir)) {
      for (const entry of fs.readdirSync(parentDir)) {
        if (entry.startsWith(`${baseName}.bak-`)) {
          const oldBak = path.join(parentDir, entry);
          fs.unlinkSync(oldBak);
          console.log(`Purged backup: ${oldBak}`);
        }
      }
    }
  }
}

fs.unlinkSync(manifestPath);
console.log(`Removed manifest: ${manifestPath}`);
EOF
done

if [[ -z "$TARGET" && -f "$MANIFEST_DIR/install-manifest.json" ]]; then
  shopt -s nullglob
  REMAINING=("$MANIFEST_DIR"/install-manifest-*.json)
  shopt -u nullglob
  if [[ ${#REMAINING[@]} -eq 0 ]]; then
    rm -f "$MANIFEST_DIR/install-manifest.json"
  fi
fi

echo "Uninstallation finished."
