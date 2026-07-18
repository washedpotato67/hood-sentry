#!/usr/bin/env sh
# Fetch the Foundry libraries for packages/contracts. They live under a
# git-ignored lib/ (not submodules), so a fresh checkout — CI especially — has
# to clone them at pinned versions before `forge build` can resolve imports.
set -eu

lib="$(CDPATH= cd "$(dirname "$0")/../packages/contracts" && pwd)/lib"
mkdir -p "$lib"

clone() {
  repo="$1"
  ref="$2"
  dest="$lib/$3"
  if [ -d "$dest/.git" ] || [ -f "$dest/foundry.toml" ] || [ -d "$dest/contracts" ] || [ -d "$dest/src" ]; then
    echo "contract dep already present: $3"
    return 0
  fi
  echo "cloning $3 ($ref)"
  git clone --depth 1 --branch "$ref" "https://github.com/$repo.git" "$dest"
}

clone "OpenZeppelin/openzeppelin-contracts" "v5.6.1" "openzeppelin-contracts"
clone "foundry-rs/forge-std" "v1.16.2" "forge-std"
