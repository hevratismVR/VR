#!/bin/bash
#
# TalkSphere Generator Watchdog Script
# =====================================
# Keeps the generator running continuously, restarting on crash.
# Saves checkpoint after every batch for maximum robustness.
#
# Usage:
#   ./run_forever.sh                    # Run with default API key from env
#   ANTHROPIC_API_KEY="sk-..." ./run_forever.sh   # Run with specific key
#
# To stop: Create a file named "STOP_GENERATOR" in the VR directory
#   touch /home/user/VR/STOP_GENERATOR
#

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GENERATOR_SCRIPT="$SCRIPT_DIR/scripts/generator.py"
LOG_FILE="$SCRIPT_DIR/generation_output.log"
PID_FILE="$SCRIPT_DIR/generator.pid"
STOP_FILE="$SCRIPT_DIR/STOP_GENERATOR"
RESTART_DELAY=5  # seconds to wait before restart
MAX_RESTARTS_PER_HOUR=20
RESTART_COUNT=0
LAST_RESTART_HOUR=$(date +%H)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if API key is set
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo -e "${RED}ERROR: ANTHROPIC_API_KEY environment variable not set${NC}"
    echo "Usage: ANTHROPIC_API_KEY='sk-...' ./run_forever.sh"
    exit 1
fi

# Remove stop file if exists from previous run
rm -f "$STOP_FILE"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}TalkSphere Generator Watchdog${NC}"
echo -e "${GREEN}========================================${NC}"
echo "Log file: $LOG_FILE"
echo "PID file: $PID_FILE"
echo "To stop gracefully: touch $STOP_FILE"
echo -e "${GREEN}========================================${NC}"
echo ""

# Function to check if generator is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Function to start the generator
start_generator() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] Starting generator...${NC}"

    # Start generator in background
    python3 "$GENERATOR_SCRIPT" >> "$LOG_FILE" 2>&1 &
    PID=$!
    echo $PID > "$PID_FILE"

    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] Generator started with PID: $PID${NC}"

    # Track restarts
    CURRENT_HOUR=$(date +%H)
    if [ "$CURRENT_HOUR" != "$LAST_RESTART_HOUR" ]; then
        RESTART_COUNT=0
        LAST_RESTART_HOUR=$CURRENT_HOUR
    fi
    ((RESTART_COUNT++))

    if [ $RESTART_COUNT -gt $MAX_RESTARTS_PER_HOUR ]; then
        echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] Too many restarts ($RESTART_COUNT) in the last hour. Stopping.${NC}"
        exit 1
    fi
}

# Function to stop the generator
stop_generator() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] Stopping generator (PID: $PID)...${NC}"
            kill "$PID" 2>/dev/null
            sleep 2
            if ps -p "$PID" > /dev/null 2>&1; then
                kill -9 "$PID" 2>/dev/null
            fi
        fi
        rm -f "$PID_FILE"
    fi
}

# Cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] Watchdog stopping...${NC}"
    stop_generator
    rm -f "$STOP_FILE"
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] Cleanup complete.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Main watchdog loop
echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] Watchdog starting...${NC}"

while true; do
    # Check for stop signal
    if [ -f "$STOP_FILE" ]; then
        echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] Stop signal received.${NC}"
        cleanup
    fi

    # Check if generator is running
    if ! is_running; then
        echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] Generator not running. Restarting in ${RESTART_DELAY}s...${NC}"
        sleep $RESTART_DELAY

        # Check stop signal again before restarting
        if [ -f "$STOP_FILE" ]; then
            cleanup
        fi

        start_generator
    fi

    # Wait before next check
    sleep 10

    # Show status every 5 minutes
    if [ $(($(date +%s) % 300)) -lt 10 ]; then
        if [ -f "$SCRIPT_DIR/checkpoint.json" ]; then
            COMPLETED=$(grep -o '"completed_words": [0-9]*' "$SCRIPT_DIR/checkpoint.json" | grep -o '[0-9]*')
            ITEMS=$(grep -o '"total_items_generated": [0-9]*' "$SCRIPT_DIR/checkpoint.json" | grep -o '[0-9]*')
            echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] Status: ${COMPLETED:-0}/1000 words, ${ITEMS:-0} items generated${NC}"
        fi
    fi
done
