#!/bin/bash
# PICO 4 VR Manager - Setup Script
# Installs dependencies and configures ADB for PICO 4

set -e

echo "========================================="
echo "  PICO 4 VR Manager - Setup"
echo "========================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo "Install Node.js 18+ from: https://nodejs.org"
    exit 1
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
echo "[OK] Node.js $(node -v)"

# Check ADB
if ! command -v adb &> /dev/null; then
    echo ""
    echo "[WARNING] ADB is not installed!"
    echo ""
    echo "Install ADB:"
    echo "  Ubuntu/Debian: sudo apt install android-tools-adb"
    echo "  macOS:         brew install android-platform-tools"
    echo "  Windows:       Download from https://developer.android.com/tools/releases/platform-tools"
    echo ""
    read -p "Continue without ADB? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "[OK] ADB $(adb --version | head -1)"
fi

# Install npm dependencies
echo ""
echo "Installing dependencies..."
cd "$(dirname "$0")"
npm install

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "  PICO 4 Headset Preparation:"
echo "  1. On each PICO 4, go to Settings > General > Developer"
echo "  2. Enable 'USB Debugging'"
echo "  3. Enable 'Wireless Debugging' (ADB over WiFi)"
echo "  4. Connect all headsets to the same WiFi network"
echo ""
echo "  Start the server:"
echo "    npm start"
echo ""
echo "  Then open in tablet browser:"
echo "    http://<tablet-ip>:3000"
echo ""
