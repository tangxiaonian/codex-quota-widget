#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Exercise AppKit against a temporary test window; never launch the account provider.
test_binary="$(mktemp -t quota-widget-native-test)"
trap 'rm -f "$test_binary"' EXIT
clang -fobjc-arc -framework AppKit -framework QuartzCore tests/native/top_hide_test.m -o "$test_binary"
"$test_binary"
