#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O -o dita-hotkeys DitaHotkeys.swift
echo "ok: $(pwd)/dita-hotkeys"
