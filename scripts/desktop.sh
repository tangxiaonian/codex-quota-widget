#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -d "$PWD/.toolchain/cargo/bin" ]]; then
  export CARGO_HOME="$PWD/.toolchain/cargo"
  export RUSTUP_HOME="$PWD/.toolchain/rustup"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
exec npm exec tauri -- "$@"
