#!/bin/bash
# TalkSphere Hebrew Word Database Generator
# Run script for easy execution

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "  TalkSphere Database Generator"
echo "========================================"
echo ""

# Check for API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo -e "${RED}Error: ANTHROPIC_API_KEY environment variable not set${NC}"
    echo ""
    echo "Please set your API key:"
    echo "  export ANTHROPIC_API_KEY='your-api-key-here'"
    echo ""
    echo "Or run with:"
    echo "  ANTHROPIC_API_KEY='your-key' ./run.sh [options]"
    exit 1
fi

echo -e "${GREEN}✓ API key found${NC}"

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Python 3 found${NC}"

# Check/install dependencies
echo ""
echo "Checking dependencies..."
pip3 install -q -r requirements.txt 2>/dev/null || {
    echo -e "${YELLOW}Installing dependencies...${NC}"
    pip3 install -r requirements.txt
}
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Show help if requested
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    echo ""
    echo "Usage: ./run.sh [option]"
    echo ""
    echo "Options:"
    echo "  --test          Generate first 3 words only (test mode)"
    echo "  --resume        Resume from last checkpoint"
    echo "  --validate      Validate existing output only"
    echo "  --word WORD     Generate specific Hebrew word"
    echo "  --start N       Start from word index N"
    echo "  --end N         End at word index N"
    echo "  --help          Show this help"
    echo ""
    echo "Examples:"
    echo "  ./run.sh --test              # Test with first 3 words"
    echo "  ./run.sh --word אני          # Generate specific word"
    echo "  ./run.sh --start 10 --end 20 # Generate words 10-20"
    echo "  ./run.sh --resume            # Continue from checkpoint"
    echo ""
    exit 0
fi

echo ""
echo "========================================"
echo "  Starting Generation..."
echo "========================================"
echo ""

# Run generator with passed arguments
python3 scripts/generator.py "$@"
