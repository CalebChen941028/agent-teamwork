#!/usr/bin/env bash
# Uninstaller for agent-teamwork
set -euo pipefail

MANIFEST_FILE="$HOME/.local/share/agent-teamwork/install-manifest.json"

if [[ ! -f "$MANIFEST_FILE" ]]; then
  echo "No manifest file found at $MANIFEST_FILE. Nothing to uninstall."
  exit 0
fi

node -e '
const fs = require("node:fs");
const manifestPath = process.argv[1];
const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const ts = data.backup_timestamp || "";

for (const f of data.files || []) {
  const bak = ts ? `${f}.bak-${ts}` : "";
  if (bak && fs.existsSync(bak)) {
    fs.renameSync(bak, f);
    console.log(`Restored: ${f} from backup`);
  } else if (fs.existsSync(f)) {
    fs.unlinkSync(f);
    console.log(`Removed: ${f}`);
  }
}

fs.unlinkSync(manifestPath);
console.log("Removed manifest.");
' "$MANIFEST_FILE"

echo "Uninstallation finished."
