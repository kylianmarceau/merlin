#!/usr/bin/env bash
# Installs browserctl into ~/.local/bin (or $PREFIX/bin), so it can be run
# from any terminal, editor or script as plain `browserctl`.
#
#   scripts/install_browserctl.sh
#   PREFIX=/opt/homebrew scripts/install_browserctl.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PREFIX="${PREFIX:-$HOME/.local}"
cargo install --quiet --locked --path tools/browserctl --root "$PREFIX"
echo "Installed $PREFIX/bin/browserctl"
case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *) echo "Add $PREFIX/bin to your PATH, e.g. in ~/.zshrc: export PATH=\"$PREFIX/bin:\$PATH\"" ;;
esac
