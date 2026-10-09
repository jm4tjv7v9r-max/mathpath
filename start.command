#!/bin/zsh
set -eu
SCRIPT_DIR="$(dirname "$0")"
if [[ -x "/Users/laokunleng/.workbuddy-ai/binaries/python/envs/default/bin/python" ]]; then
    PYTHON="/Users/laokunleng/.workbuddy-ai/binaries/python/envs/default/bin/python"
elif [[ -x "/Users/laokunleng/.workbuddy-ai/binaries/python/versions/3.13.12/bin/python3" ]]; then
    PYTHON="/Users/laokunleng/.workbuddy-ai/binaries/python/versions/3.13.12/bin/python3"
else
    PYTHON="python3"
fi
exec "$PYTHON" "$SCRIPT_DIR/server.py" "$@"
