#!/bin/bash
#
# axi-lab Uninstallation Script
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}axi-lab Uninstallation${NC}"
echo ""

# Detect OS
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
fi

if [[ "$OS" == "macos" ]]; then
    # Remove launchd services
    if [[ -f "$HOME/Library/LaunchAgents/com.axi.lab.plist" ]]; then
        echo "Removing launchd service..."
        launchctl unload "$HOME/Library/LaunchAgents/com.axi.lab.plist" 2>/dev/null || true
        rm -f "$HOME/Library/LaunchAgents/com.axi.lab.plist"
    fi

    if [[ -f "$HOME/Library/LaunchAgents/com.axi.tmux.plist" ]]; then
        echo "Removing tmux launchd service..."
        launchctl unload "$HOME/Library/LaunchAgents/com.axi.tmux.plist" 2>/dev/null || true
        rm -f "$HOME/Library/LaunchAgents/com.axi.tmux.plist"
    fi

    # Kill tmux session
    tmux kill-session -t axi 2>/dev/null || true

elif [[ "$OS" == "linux" ]]; then
    # Remove systemd service
    if [[ -f "/etc/systemd/system/axi-lab.service" ]]; then
        echo "Removing systemd service..."
        sudo systemctl stop axi-lab 2>/dev/null || true
        sudo systemctl disable axi-lab 2>/dev/null || true
        sudo rm -f /etc/systemd/system/axi-lab.service
        sudo systemctl daemon-reload
    fi
fi

# Remove logs
rm -f /tmp/axi-lab.log
rm -f /tmp/axi-lab.error.log
rm -f /tmp/axi-lab-tmux.log
rm -f /tmp/axi-lab-tmux.error.log

echo -e "${GREEN}Uninstallation complete!${NC}"
echo ""
echo "The source code has NOT been removed."
echo "To fully remove, delete the axi-lab directory."
