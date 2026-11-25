#!/usr/bin/env bash
set -euo pipefail
# Compatibility entry point; safety checks live in the cross-platform runner.
exec node "$(dirname "$0")/run-e2e.mjs"
