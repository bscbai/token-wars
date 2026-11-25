#!/usr/bin/env bash
# Start the Token Wars demo server when a Codespace boots.
# The forwarded port 3000 is public (see devcontainer.json), so the preview URL
# is a live arena: no local install, no server credentials.
set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root/token-wars"

# A resumed Codespace may still have the previous demo process around.
pkill -f 'scripts/demo.cjs' 2>/dev/null || true
sleep 1

nohup npm run demo > /tmp/token-wars-demo.log 2>&1 &
echo "$!" > /tmp/token-wars-demo.pid

# Give the server a moment, then surface the boot log in the terminal.
sleep 4
tail -n 8 /tmp/token-wars-demo.log
