#!/usr/bin/env bash
# Installs merlin into ~/.local/bin (or $PREFIX/bin), so it can be run
# from any terminal, editor or script as plain `merlin`.
#
#   scripts/install_merlin_cli.sh
#   PREFIX=/opt/homebrew scripts/install_merlin_cli.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PREFIX="${PREFIX:-$HOME/.local}"
cargo install --quiet --locked --path tools/merlin --root "$PREFIX"
echo "Installed $PREFIX/bin/merlin"
case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *) echo "Add $PREFIX/bin to your PATH, e.g. in ~/.zshrc: export PATH=\"$PREFIX/bin:\$PATH\"" ;;
esac
