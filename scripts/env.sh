# Source this file: keeps every tool cache, temp file and app profile inside the workspace.
FACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FACE_ROOT
export npm_config_cache="$FACE_ROOT/.cache/npm"
export npm_config_update_notifier=false
export electron_config_cache="$FACE_ROOT/.cache/electron"
export ELECTRON_CACHE="$FACE_ROOT/.cache/electron"
export ELECTRON_BUILDER_CACHE="$FACE_ROOT/.cache/electron-builder"
export PLAYWRIGHT_BROWSERS_PATH="$FACE_ROOT/.cache/playwright"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export XDG_CACHE_HOME="$FACE_ROOT/.cache/xdg/cache"
export XDG_CONFIG_HOME="$FACE_ROOT/.cache/xdg/config"
export XDG_DATA_HOME="$FACE_ROOT/.cache/xdg/data"
export TMPDIR="$FACE_ROOT/.cache/tmp"
export FACE_RUNTIME_DIR="$FACE_ROOT/.runtime"
export PYTHONDONTWRITEBYTECODE=1
mkdir -p "$TMPDIR" "$FACE_RUNTIME_DIR"
