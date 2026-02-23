#!/bin/bash
# PICO 4 VR Manager - Quick Launcher
# Double-click or run: ./start.sh

cd "$(dirname "$0")"

# Kill any existing instance
pkill -f "node server.js" 2>/dev/null
sleep 1

# Get local IP for display
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP="localhost"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       PICO 4 VR Manager - Starting...       ║"
echo "╠══════════════════════════════════════════════╣"
echo "║                                              ║"
echo "║  Dashboard: http://$LOCAL_IP:3000        ║"
echo "║                                              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Open browser automatically
if command -v xdg-open &>/dev/null; then
  xdg-open "http://$LOCAL_IP:3000" 2>/dev/null &
elif command -v open &>/dev/null; then
  open "http://$LOCAL_IP:3000" 2>/dev/null &
fi

# Start server
node server.js
