#!/usr/bin/env bash
# Build single-file binaries for every supported platform into dist/.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGETS=(darwin-arm64 darwin-x64 linux-x64 linux-arm64)
rm -rf dist && mkdir -p dist

for t in "${TARGETS[@]}"; do
  echo "building atom-$t"
  bun build --compile --minify --target="bun-$t" src/cli.ts --outfile "dist/atom-$t" >/dev/null
done

(cd dist && shasum -a 256 atom-* > checksums.txt)
echo; cat dist/checksums.txt
