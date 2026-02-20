#!/bin/bash
#
# AxiDraw Server Endpoint Test Script
# Tests all API endpoints via curl
#
# Usage:
#   ./test-endpoints.sh [host] [port]
#
# Default: localhost:9700
#

set -e

HOST="${1:-localhost}"
PORT="${2:-9700}"
BASE_URL="http://$HOST:$PORT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Test counters
PASSED=0
FAILED=0
SKIPPED=0

# Helper functions
header() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}============================================${NC}"
}

test_endpoint() {
    local method="$1"
    local path="$2"
    local data="$3"
    local expected="$4"
    local description="$5"

    echo -ne "${CYAN}Testing: ${NC}$method $path"
    [[ -n "$description" ]] && echo -ne " ${YELLOW}($description)${NC}"
    echo ""

    # Build curl command
    local curl_cmd="curl -s -X $method"
    [[ -n "$data" ]] && curl_cmd="$curl_cmd -H 'Content-Type: application/json' -d '$data'"
    curl_cmd="$curl_cmd '$BASE_URL$path'"

    # Execute and capture response
    local response
    response=$(eval "$curl_cmd" 2>/dev/null) || {
        echo -e "  ${RED}FAILED: Connection error${NC}"
        ((FAILED++))
        return 1
    }

    # Check response
    if [[ -n "$expected" ]]; then
        if echo "$response" | grep -q "$expected"; then
            echo -e "  ${GREEN}PASSED${NC}"
            ((PASSED++))
        else
            echo -e "  ${RED}FAILED: Expected '$expected'${NC}"
            echo -e "  Response: $response"
            ((FAILED++))
        fi
    else
        # Just check for valid JSON or any response
        if [[ -n "$response" ]]; then
            echo -e "  ${GREEN}PASSED${NC} (got response)"
            ((PASSED++))
        else
            echo -e "  ${RED}FAILED: Empty response${NC}"
            ((FAILED++))
        fi
    fi
}

skip_test() {
    local method="$1"
    local path="$2"
    local reason="$3"

    echo -e "${YELLOW}Skipping: ${NC}$method $path - $reason"
    ((SKIPPED++))
}

# Check if server is running
echo -e "${YELLOW}Testing AxiDraw Server at $BASE_URL${NC}"
echo ""

if ! curl -s "$BASE_URL/health" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Server not responding at $BASE_URL${NC}"
    echo ""
    echo "Make sure the server is running:"
    echo "  cd $(dirname "$0")/.."
    echo "  npm start"
    exit 1
fi

echo -e "${GREEN}Server is responding!${NC}"

###############################################################################
header "Status & Info Endpoints"
###############################################################################

test_endpoint "GET" "/" "" "AxiDraw HTTP API" "API documentation"
test_endpoint "GET" "/info" "" '"name":"AxiDraw HTTP API"' "JSON documentation"
test_endpoint "GET" "/health" "" '"ok"' "Health check"
test_endpoint "GET" "/status" "" '"state"' "Detailed status"
test_endpoint "GET" "/history" "" '"history"' "Action history"
test_endpoint "GET" "/ports" "" '"ports"' "List serial ports"

###############################################################################
header "Connection Endpoints"
###############################################################################

# Check current connection state
HEALTH=$(curl -s "$BASE_URL/health")
IS_CONNECTED=$(echo "$HEALTH" | grep -o '"connected":\s*true' || echo "")

if [[ -n "$IS_CONNECTED" ]]; then
    echo -e "${GREEN}AxiDraw is connected - testing connection endpoints${NC}"
    test_endpoint "GET" "/version" "" "EBB" "Get firmware version"
    test_endpoint "GET" "/nickname" "" '"nickname"' "Get nickname"

    # Don't actually disconnect/reconnect during tests
    skip_test "POST" "/disconnect" "Would disrupt connection"
    skip_test "POST" "/connect" "Already connected"
    skip_test "POST" "/initialize" "Already initialized"
else
    echo -e "${YELLOW}AxiDraw not connected - skipping hardware tests${NC}"
    skip_test "POST" "/connect" "No AxiDraw detected"
    skip_test "GET" "/version" "Not connected"
    skip_test "GET" "/nickname" "Not connected"
fi

###############################################################################
header "Pen Control Endpoints (Requires Connection)"
###############################################################################

if [[ -n "$IS_CONNECTED" ]]; then
    test_endpoint "GET" "/pen/status" "" '"pen"' "Pen status"

    # These will actually move the pen - mark as optional
    echo -e "${YELLOW}The following tests will move the pen:${NC}"
    read -p "Run pen movement tests? [y/N] " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        test_endpoint "POST" "/pen/up" "" '"success":true' "Pen up"
        sleep 1
        test_endpoint "POST" "/pen/down" "" '"success":true' "Pen down"
        sleep 1
        test_endpoint "POST" "/pen/up" "" '"success":true' "Pen up (return)"
        test_endpoint "POST" "/pen/toggle" "" '"success":true' "Pen toggle"
        sleep 1
        test_endpoint "POST" "/pen/toggle" "" '"success":true' "Pen toggle (return)"
    else
        skip_test "POST" "/pen/up" "User skipped"
        skip_test "POST" "/pen/down" "User skipped"
        skip_test "POST" "/pen/toggle" "User skipped"
    fi

    test_endpoint "POST" "/pen/config" '{"posUp":65,"posDown":35}' '"success":true' "Pen config"
else
    skip_test "GET" "/pen/status" "Not connected"
    skip_test "POST" "/pen/up" "Not connected"
    skip_test "POST" "/pen/down" "Not connected"
    skip_test "POST" "/pen/toggle" "Not connected"
fi

###############################################################################
header "Motion Endpoints (Requires Connection)"
###############################################################################

if [[ -n "$IS_CONNECTED" ]]; then
    test_endpoint "GET" "/position" "" '"position"' "Get position"

    echo -e "${YELLOW}The following tests will move the motors:${NC}"
    read -p "Run motion tests? [y/N] " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        test_endpoint "POST" "/move" '{"dx":10,"dy":0}' '"success":true' "Move relative +10mm X"
        sleep 1
        test_endpoint "POST" "/move" '{"dx":-10,"dy":0}' '"success":true' "Move relative -10mm X"
        sleep 1
        test_endpoint "POST" "/moveto" '{"x":20,"y":20}' '"success":true' "Move to 20,20mm"
        sleep 1
        test_endpoint "POST" "/home" '{}' '"success":true' "Home"
    else
        skip_test "POST" "/move" "User skipped"
        skip_test "POST" "/moveto" "User skipped"
        skip_test "POST" "/home" "User skipped"
    fi
else
    skip_test "GET" "/position" "Not connected"
    skip_test "POST" "/move" "Not connected"
    skip_test "POST" "/moveto" "Not connected"
    skip_test "POST" "/home" "Not connected"
fi

###############################################################################
header "Speed Configuration Endpoints"
###############################################################################

test_endpoint "GET" "/speed" "" '"speed"' "Get speed settings"
test_endpoint "POST" "/speed" '{"penDown":2.0,"penUp":6.0}' '"success":true' "Set speeds"
# Reset to defaults
test_endpoint "POST" "/speed" '{"penDown":2.5,"penUp":7.5}' '"success":true' "Reset speeds"

###############################################################################
header "Motor Control Endpoints"
###############################################################################

if [[ -n "$IS_CONNECTED" ]]; then
    # These are safe to call
    test_endpoint "POST" "/motors/on" "" '"success":true' "Motors on"
    # Don't turn off motors during test as it would mess up position
    skip_test "POST" "/motors/off" "Would disable motors"
    skip_test "POST" "/stop" "Emergency stop - skip in tests"
else
    skip_test "POST" "/motors/on" "Not connected"
    skip_test "POST" "/motors/off" "Not connected"
    skip_test "POST" "/stop" "Not connected"
fi

###############################################################################
header "Queue Endpoints"
###############################################################################

test_endpoint "GET" "/queue" "" '"status"' "Get queue status"
test_endpoint "GET" "/queue/history" "" '"history"' "Get queue history"

# Add a test job (commands that won't execute without connection)
TEST_JOB='{"type":"commands","data":[{"type":"penUp"}],"name":"Test Job"}'
QUEUE_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -d "$TEST_JOB" "$BASE_URL/queue")

if echo "$QUEUE_RESPONSE" | grep -q '"success":true'; then
    echo -e "  ${GREEN}PASSED${NC} POST /queue (Add job)"
    ((PASSED++))

    # Extract job ID
    JOB_ID=$(echo "$QUEUE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [[ -n "$JOB_ID" ]]; then
        # Cancel the test job
        test_endpoint "DELETE" "/queue/$JOB_ID" "" "" "Cancel job"
    fi
else
    echo -e "  ${RED}FAILED${NC} POST /queue"
    ((FAILED++))
fi

test_endpoint "POST" "/queue/pause" "" '"success":true' "Pause queue"
test_endpoint "POST" "/queue/resume" "" '"success":true' "Resume queue"
test_endpoint "POST" "/queue/clear" "" '"success":true' "Clear queue"

###############################################################################
header "SVG Endpoints"
###############################################################################

# Test SVG preview (doesn't require connection)
TEST_SVG='<svg><line x1="0" y1="0" x2="100" y2="100"/></svg>'
test_endpoint "POST" "/svg/preview" "{\"svg\":\"$TEST_SVG\"}" '"commands"' "SVG preview"

# Test SVG queue
SVG_QUEUE_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
    -d "{\"svg\":\"$TEST_SVG\",\"name\":\"Test SVG\"}" \
    "$BASE_URL/svg")

if echo "$SVG_QUEUE_RESPONSE" | grep -q '"success":true'; then
    echo -e "  ${GREEN}PASSED${NC} POST /svg (Queue SVG)"
    ((PASSED++))

    # Cancel the SVG job
    JOB_ID=$(echo "$SVG_QUEUE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [[ -n "$JOB_ID" ]]; then
        curl -s -X DELETE "$BASE_URL/queue/$JOB_ID" > /dev/null
    fi
else
    echo -e "  ${RED}FAILED${NC} POST /svg"
    echo "  Response: $SVG_QUEUE_RESPONSE"
    ((FAILED++))
fi

###############################################################################
header "Execute Command Endpoint"
###############################################################################

# Test execute endpoint (structure only, won't move if not connected)
EXEC_CMD='{"commands":[{"type":"penUp"}]}'
if [[ -n "$IS_CONNECTED" ]]; then
    test_endpoint "POST" "/execute" "$EXEC_CMD" '"success":true' "Execute commands"
else
    skip_test "POST" "/execute" "Not connected"
fi

###############################################################################
header "Error Handling"
###############################################################################

# Test 404
test_endpoint "GET" "/nonexistent" "" '"error"' "404 Not Found"

# Test invalid JSON
BAD_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -d '{invalid}' "$BASE_URL/queue" 2>/dev/null)
if echo "$BAD_RESPONSE" | grep -q '"error"'; then
    echo -e "  ${GREEN}PASSED${NC} Invalid JSON handling"
    ((PASSED++))
else
    echo -e "  ${RED}FAILED${NC} Invalid JSON handling"
    ((FAILED++))
fi

# Test missing parameters
test_endpoint "POST" "/move" '{"dx":10}' '"error"' "Missing parameter error"

###############################################################################
header "Test Summary"
###############################################################################

echo ""
echo -e "Results:"
echo -e "  ${GREEN}Passed:  $PASSED${NC}"
echo -e "  ${RED}Failed:  $FAILED${NC}"
echo -e "  ${YELLOW}Skipped: $SKIPPED${NC}"
echo ""

TOTAL=$((PASSED + FAILED))
if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}All $TOTAL tests passed!${NC}"
    exit 0
else
    echo -e "${RED}$FAILED of $TOTAL tests failed${NC}"
    exit 1
fi
