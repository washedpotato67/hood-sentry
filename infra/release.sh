#!/usr/bin/env sh
set -eu
echo "Release requires CI approval and environment-specific secret-store credentials."
echo "Run migrations with the managed deployment command, then smoke tests before promotion."
