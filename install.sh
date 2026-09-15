#!/bin/sh
# atom installer
#   curl -fsSL https://raw.githubusercontent.com/ericyhliu/atom/main/install.sh | sh
#
# Downloads the latest release binary for this platform into ~/.atom/bin
# and adds it to PATH. Re-run to upgrade. Set ATOM_VERSION=v0.1.0 to pin.
set -eu

REPO="ericyhliu/atom"
INSTALL_DIR="${ATOM_INSTALL_DIR:-$HOME/.atom/bin}"

# --- platform ---------------------------------------------------------------
os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) os=darwin ;;
  Linux)  os=linux ;;
  *) echo "error: unsupported OS: $os" >&2; exit 1 ;;
esac
case "$arch" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64)  arch=x64 ;;
  *) echo "error: unsupported architecture: $arch" >&2; exit 1 ;;
esac
asset="atom-$os-$arch"

# --- version ----------------------------------------------------------------
if [ -n "${ATOM_VERSION:-}" ]; then
  version="$ATOM_VERSION"
else
  version=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
  [ -n "$version" ] || { echo "error: could not resolve latest version" >&2; exit 1; }
fi
base="${ATOM_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download/$version}"

# --- download + verify ------------------------------------------------------
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "downloading atom $version ($os-$arch)"
curl -fsSL "$base/$asset" -o "$tmp/atom"
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt"

expected=$(grep " $asset\$" "$tmp/checksums.txt" | cut -d' ' -f1)
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/atom" | cut -d' ' -f1)
else
  actual=$(shasum -a 256 "$tmp/atom" | cut -d' ' -f1)
fi
if [ "$expected" != "$actual" ]; then
  echo "error: checksum mismatch for $asset" >&2
  echo "  expected $expected" >&2
  echo "  actual   $actual" >&2
  exit 1
fi

# --- install ----------------------------------------------------------------
mkdir -p "$INSTALL_DIR"
mv "$tmp/atom" "$INSTALL_DIR/atom"
chmod +x "$INSTALL_DIR/atom"

# --- PATH -------------------------------------------------------------------
path_line="export PATH=\"$INSTALL_DIR:\$PATH\""
case ":$PATH:" in
  *":$INSTALL_DIR:"*) on_path=1 ;;
  *) on_path=0 ;;
esac

if [ "$on_path" = 0 ]; then
  shell_name=$(basename "${SHELL:-sh}")
  case "$shell_name" in
    zsh)  rc="$HOME/.zshrc" ;;
    bash) rc="$HOME/.bashrc" ;;
    fish) rc="" ;;
    *)    rc="$HOME/.profile" ;;
  esac
  if [ -n "$rc" ] && ! grep -qs "$INSTALL_DIR" "$rc"; then
    printf '\n# atom\n%s\n' "$path_line" >> "$rc"
    echo "added $INSTALL_DIR to PATH in $rc"
  fi
fi

echo
echo "installed atom $version to $INSTALL_DIR/atom"
[ "$on_path" = 0 ] && echo "restart your shell (or run: $path_line)"
echo "then:  export TOGETHER_API_KEY=your_key && atom"
