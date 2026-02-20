#!/bin/bash
#
# AxiDraw Server Installation Script
# Supports macOS and Linux
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  AxiDraw Server Installation${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Detect OS
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    echo -e "${GREEN}Detected: macOS${NC}"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    echo -e "${GREEN}Detected: Linux${NC}"
else
    echo -e "${RED}Unsupported OS: $OSTYPE${NC}"
    exit 1
fi

# Check for Node.js
echo ""
echo -e "${YELLOW}Checking dependencies...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed!${NC}"
    echo ""
    if [[ "$OS" == "macos" ]]; then
        echo "Install with Homebrew:"
        echo "  brew install node"
    else
        echo "Install with your package manager:"
        echo "  sudo apt install nodejs npm"
        echo "  # or"
        echo "  sudo dnf install nodejs npm"
    fi
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "  Node.js: ${GREEN}$NODE_VERSION${NC}"

# Check Node.js version (need >= 18)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1 | sed 's/v//')
if [[ $NODE_MAJOR -lt 18 ]]; then
    echo -e "${RED}Node.js 18+ required, found $NODE_VERSION${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm is not installed!${NC}"
    exit 1
fi

NPM_VERSION=$(npm --version)
echo -e "  npm: ${GREEN}$NPM_VERSION${NC}"

# Install dependencies
echo ""
echo -e "${YELLOW}Installing npm dependencies...${NC}"
cd "$PROJECT_DIR"
npm install

echo -e "${GREEN}Dependencies installed successfully${NC}"

# Serial port permissions (Linux)
if [[ "$OS" == "linux" ]]; then
    echo ""
    echo -e "${YELLOW}Setting up serial port permissions...${NC}"

    # Add user to dialout group for serial access
    CURRENT_USER=$(whoami)
    if ! groups "$CURRENT_USER" | grep -q dialout; then
        echo "Adding $CURRENT_USER to dialout group..."
        sudo usermod -a -G dialout "$CURRENT_USER"
        echo -e "${YELLOW}NOTE: You may need to log out and back in for group changes to take effect${NC}"
    else
        echo -e "  User already in dialout group"
    fi
fi

# Service installation prompt
echo ""
echo -e "${YELLOW}Service Installation${NC}"
echo ""
echo "Choose how to install the service:"
echo "  1) launchd service (macOS) - runs as daemon"
echo "  2) tmux session (macOS) - runs in tmux for easy monitoring"
echo "  3) systemd service (Linux)"
echo "  4) Skip service installation"
echo ""
read -p "Enter choice [1-4]: " SERVICE_CHOICE

case $SERVICE_CHOICE in
    1)
        if [[ "$OS" != "macos" ]]; then
            echo -e "${RED}launchd is only available on macOS${NC}"
            exit 1
        fi

        PLIST_SRC="$PROJECT_DIR/services/com.axidraw.server.plist"
        PLIST_DST="$HOME/Library/LaunchAgents/com.axidraw.server.plist"

        # Update paths in plist
        sed -e "s|\$HOME|$HOME|g" \
            -e "s|/Users/zooey|$HOME|g" \
            "$PLIST_SRC" > "$PLIST_DST"

        echo "Installing launchd service..."
        launchctl unload "$PLIST_DST" 2>/dev/null || true
        launchctl load "$PLIST_DST"

        echo -e "${GREEN}Service installed!${NC}"
        echo ""
        echo "Control commands:"
        echo "  Start:  launchctl start com.axidraw.server"
        echo "  Stop:   launchctl stop com.axidraw.server"
        echo "  Reload: launchctl unload ~/Library/LaunchAgents/com.axidraw.server.plist && launchctl load ~/Library/LaunchAgents/com.axidraw.server.plist"
        echo "  Logs:   tail -f /tmp/axidraw-server.log"
        ;;

    2)
        if [[ "$OS" != "macos" ]]; then
            echo -e "${RED}This option is designed for macOS${NC}"
            exit 1
        fi

        PLIST_SRC="$PROJECT_DIR/services/axidraw-tmux.plist"
        PLIST_DST="$HOME/Library/LaunchAgents/com.axidraw.tmux.plist"

        # Update paths in plist
        sed -e "s|\$HOME|$HOME|g" \
            -e "s|/Users/zooey|$HOME|g" \
            "$PLIST_SRC" > "$PLIST_DST"

        echo "Installing tmux-based service..."
        launchctl unload "$PLIST_DST" 2>/dev/null || true
        launchctl load "$PLIST_DST"

        echo -e "${GREEN}Service installed!${NC}"
        echo ""
        echo "Control commands:"
        echo "  Attach:  tmux attach -t axi"
        echo "  Detach:  Ctrl+B then D"
        echo "  Restart: launchctl stop com.axidraw.tmux && launchctl start com.axidraw.tmux"
        ;;

    3)
        if [[ "$OS" != "linux" ]]; then
            echo -e "${RED}systemd is only available on Linux${NC}"
            exit 1
        fi

        SERVICE_SRC="$PROJECT_DIR/services/axidraw-server.service"
        SERVICE_DST="/etc/systemd/system/axidraw-server.service"

        # Update paths in service file
        CURRENT_USER=$(whoami)
        sudo sed -e "s|User=zooey|User=$CURRENT_USER|g" \
                 -e "s|Group=zooey|Group=$CURRENT_USER|g" \
                 -e "s|/home/zooey|$HOME|g" \
                 "$SERVICE_SRC" | sudo tee "$SERVICE_DST" > /dev/null

        echo "Installing systemd service..."
        sudo systemctl daemon-reload
        sudo systemctl enable axidraw-server
        sudo systemctl start axidraw-server

        echo -e "${GREEN}Service installed and started!${NC}"
        echo ""
        echo "Control commands:"
        echo "  Status:  sudo systemctl status axidraw-server"
        echo "  Start:   sudo systemctl start axidraw-server"
        echo "  Stop:    sudo systemctl stop axidraw-server"
        echo "  Restart: sudo systemctl restart axidraw-server"
        echo "  Logs:    sudo journalctl -u axidraw-server -f"
        ;;

    4)
        echo "Skipping service installation."
        echo ""
        echo "To run manually:"
        echo "  cd $PROJECT_DIR"
        echo "  npm start"
        ;;

    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  Installation Complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo "Server URL: http://localhost:9700"
echo "API Docs:   http://localhost:9700/"
echo "Health:     http://localhost:9700/health"
echo ""
echo "Test with:"
echo "  curl http://localhost:9700/health"
echo ""
