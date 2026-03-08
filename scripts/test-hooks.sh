#!/usr/bin/env bash
# Test all hook scripts for Claude Code hook protocol compliance.
# Each script must:
#   1. Not crash on valid JSON input
#   2. Pass through stdin JSON to stdout
#   3. Use stderr for messages (never pollute stdout)
#   4. Handle edge cases (empty input, missing fields)

set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

run_test() {
  local script="$1"
  local test_name="$2"
  local input="$3"
  local script_path="$SCRIPTS_DIR/$script"
  TOTAL=$((TOTAL + 1))

  if [ ! -f "$script_path" ]; then
    echo -e "${RED}FAIL${NC} [$script] $test_name — file not found"
    FAIL=$((FAIL + 1))
    return
  fi

  local stdout stderr exit_code
  stdout=$(echo "$input" | node "$script_path" 2>/tmp/sf-test-stderr.txt) || exit_code=$?
  stderr=$(cat /tmp/sf-test-stderr.txt 2>/dev/null || echo "")
  exit_code=${exit_code:-0}

  if [ "$exit_code" -ne 0 ]; then
    echo -e "${RED}FAIL${NC} [$script] $test_name — exit code $exit_code"
    echo "  stderr: $stderr"
    FAIL=$((FAIL + 1))
    return
  fi

  # Trim trailing whitespace for comparison
  local trimmed_stdout trimmed_input
  trimmed_stdout=$(echo "$stdout" | sed 's/[[:space:]]*$//')
  trimmed_input=$(echo "$input" | sed 's/[[:space:]]*$//')

  if [ "$trimmed_stdout" != "$trimmed_input" ]; then
    echo -e "${RED}FAIL${NC} [$script] $test_name — stdout doesn't match input"
    echo "  input:  '$trimmed_input'"
    echo "  stdout: '$trimmed_stdout'"
    FAIL=$((FAIL + 1))
    return
  fi

  echo -e "${GREEN}PASS${NC} [$script] $test_name"
  if [ -n "$stderr" ]; then
    echo -e "  ${YELLOW}stderr:${NC} $(echo "$stderr" | head -1)"
  fi
  PASS=$((PASS + 1))
}

echo "=== Sprint Forge Hook Script Tests ==="
echo ""

# --- session-start.js ---
run_test "session-start.js" "valid JSON passthrough" \
  '{"session_id":"test-123"}'
run_test "session-start.js" "empty JSON object" \
  '{}'

# --- session-end.js ---
run_test "session-end.js" "valid JSON passthrough" \
  '{"session_id":"test-123"}'
run_test "session-end.js" "empty JSON object" \
  '{}'

# --- session-check.js ---
run_test "session-check.js" "valid JSON passthrough" \
  '{"session_id":"test-123"}'

# --- quality-gate.js ---
run_test "quality-gate.js" "edit tool event" \
  '{"tool":"Edit","tool_input":{"file_path":"src/test.ts","new_string":"const x = 1;"}}'

# --- post-edit-check.js ---
run_test "post-edit-check.js" "clean code edit" \
  '{"tool":"Edit","tool_input":{"file_path":"src/clean.ts","new_string":"const x = 1;"},"tool_output":{"output":"success"}}'
run_test "post-edit-check.js" "edit with console.log" \
  '{"tool":"Edit","tool_input":{"file_path":"src/test.ts","new_string":"console.log(\"debug\")"},"tool_output":{"output":"success"}}'
run_test "post-edit-check.js" "edit with TODO" \
  '{"tool":"Edit","tool_input":{"file_path":"src/test.ts","new_string":"// TODO fix this"},"tool_output":{"output":"success"}}'
run_test "post-edit-check.js" "empty input" \
  ''
run_test "post-edit-check.js" "missing tool_input fields" \
  '{"tool":"Edit"}'

# --- learn-capture.js ---
run_test "learn-capture.js" "message with LEARN block" \
  '{"last_assistant_message":"I found that [LEARN] Testing: Always run tests before committing"}'
run_test "learn-capture.js" "message without LEARN block" \
  '{"last_assistant_message":"Just a normal response"}'
run_test "learn-capture.js" "empty input" \
  ''

# --- drift-detector.js ---
run_test "drift-detector.js" "sprint-related message" \
  '{"user_message":"Can you implement the login feature?"}'
run_test "drift-detector.js" "unrelated long message" \
  '{"user_message":"Can you help me write a poem about cats and dogs playing in the park together?"}'
run_test "drift-detector.js" "empty message" \
  '{"user_message":""}'

# --- rule-checker.js ---
run_test "rule-checker.js" "estimation question" \
  '{"user_message":"How long will the refactor take?"}'
run_test "rule-checker.js" "normal question" \
  '{"user_message":"What does this function do?"}'

# --- context-warning.js ---
run_test "context-warning.js" "compact event" \
  '{"event":"context_compact"}'

# --- task-complete.js ---
run_test "task-complete.js" "task with ID" \
  '{"task_id":"TASK-001"}'
run_test "task-complete.js" "task without ID" \
  '{"status":"done"}'
run_test "task-complete.js" "empty input" \
  ''

echo ""
echo "=== Results ==="
echo -e "Total: $TOTAL  ${GREEN}Pass: $PASS${NC}  ${RED}Fail: $FAIL${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
