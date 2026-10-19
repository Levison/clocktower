#!/usr/bin/env bash
# Start or stop the Blood on the Clocktower lobby and its Tailscale Funnel
# from Git Bash / MinGW on this Windows host. No hostnames, auth keys, or
# tailnet settings are stored here.
#
#   ./lobby-host.sh start
#   ./lobby-host.sh stop
#
# Setup steps are in TAILSCALE.md.
#
# Tailscale 1.96 has no `funnel --terminate-on`. Stop turns the HTTPS proxy off
# only when Funnel is serving this lobby and nothing else. It does not reset Funnel.

set -euo pipefail

# Keep Git Bash from rewriting flags such as --https=443 into Windows paths.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

PORT=7105
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT/.lobby.pid"

usage() {
  echo "Usage: ./lobby-host.sh start|stop" >&2
  exit 1
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Could not find $1 on PATH." >&2
    exit 1
  }
}

run_timeout() {
  local seconds="$1"
  shift
  local outfile child i code
  outfile="$(mktemp)"
  "$@" >"$outfile" 2>&1 &
  child=$!
  for ((i = 0; i < seconds; i++)); do
    if ! kill -0 "$child" 2>/dev/null; then
      wait "$child" && code=0 || code=$?
      cat "$outfile"
      rm -f "$outfile"
      return "$code"
    fi
    sleep 1
  done
  taskkill /F /T /PID "$child" >/dev/null 2>&1 || kill "$child" 2>/dev/null || true
  wait "$child" 2>/dev/null || true
  cat "$outfile"
  rm -f "$outfile"
  return 124
}

listen_pids() {
  netstat -ano | awk -v port=":${PORT}$" '
    $1 == "TCP" && $4 == "LISTENING" && $2 ~ port { print $5 }
  ' | sort -u
}

process_field() {
  local field="$1"
  local pid="$2"
  local value
  value="$(powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').${field}")"
  value="${value//$'\r'/}"
  value="${value%$'\n'}"
  printf '%s' "$value"
}

is_lobby_process() {
  local pid="$1"
  local name cmd
  name="$(process_field Name "$pid")"
  cmd="$(process_field CommandLine "$pid")"
  [[ "$name" == "node.exe" ]] || return 1
  [[ "$cmd" =~ (^|[[:space:]\"])server\.js($|[[:space:]\"]) ]]
}

is_lobby_proxy() {
  [[ "$1" =~ ^(https?://)?(127\.0\.0\.1|localhost):${PORT}/?$ ]]
}

funnel_status() {
  local output code
  set +e
  output="$(run_timeout 30 tailscale funnel status)"
  code=$?
  set -e
  if (( code == 124 )); then
    echo "tailscale funnel status timed out." >&2
    return 1
  fi
  if (( code != 0 )); then
    echo "tailscale funnel status failed:" >&2
    printf '%s\n' "$output" >&2
    return "$code"
  fi
  printf '%s\n' "$output"
}

proxy_targets() {
  local status="$1"
  printf '%s\n' "$status" | sed -n 's/.*proxy[[:space:]]\{1,\}\([^[:space:]]*\).*/\1/p'
}

stop_funnel() {
  local status targets=() target foreign=0 https_port output code
  set +e
  status="$(funnel_status)"
  code=$?
  set -e
  if (( code != 0 )); then
    return "$code"
  fi
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    targets+=("$target")
  done < <(proxy_targets "$status")

  if ((${#targets[@]} == 0)) || [[ "$status" == *"No serve config"* ]]; then
    echo "Funnel is already off."
    return 0
  fi

  for target in "${targets[@]}"; do
    if ! is_lobby_proxy "$target"; then
      foreign=1
    fi
  done
  if (( foreign )); then
    echo "Funnel is serving something other than this lobby. Leaving it alone:"
    printf '%s\n' "$status"
    return 1
  fi

  https_port=443
  if [[ "$status" =~ https://[^[:space:]]+:([0-9]+) ]]; then
    https_port="${BASH_REMATCH[1]}"
  fi

  set +e
  output="$(run_timeout 30 tailscale funnel "--https=${https_port}" off)"
  code=$?
  set -e
  if (( code == 124 )); then
    echo "tailscale funnel --https=${https_port} off timed out." >&2
    printf '%s\n' "$output" >&2
    return 1
  fi
  if (( code != 0 )); then
    echo "Could not turn Funnel off:" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi

  set +e
  status="$(funnel_status)"
  code=$?
  set -e
  if (( code != 0 )); then
    return "$code"
  fi
  if [[ "$status" != *"No serve config"* ]] && [[ -n "$(proxy_targets "$status")" ]]; then
    echo "Funnel is still configured:" >&2
    printf '%s\n' "$status" >&2
    return 1
  fi
  echo "Funnel closed."
  return 0
}

stop_lobby() {
  local pids=() pid info
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    pids+=("$pid")
  done < <(listen_pids)

  if ((${#pids[@]} == 0)); then
    rm -f "$PID_FILE"
    echo "Lobby is not listening on port ${PORT}."
    return 0
  fi

  for pid in "${pids[@]}"; do
    if ! is_lobby_process "$pid"; then
      info="$(process_field Name "$pid") $(process_field CommandLine "$pid")"
      echo "Port ${PORT} is in use by a process that is not this lobby (${info}). Not killing it."
      exit 1
    fi
    taskkill /F /PID "$pid" >/dev/null
    echo "Stopped lobby process ${pid}."
  done
  rm -f "$PID_FILE"
}

wait_for_lobby() {
  local i body
  for ((i = 0; i < 20; i++)); do
    sleep 0.25
    if body="$(curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/" 2>/dev/null)" \
      && [[ "$body" == *"Blood on the Clocktower"* ]]; then
      return 0
    fi
  done
  return 1
}

start_lobby() {
  local pids=() pid node_win win_root out_log err_log
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    pids+=("$pid")
  done < <(listen_pids)

  if ((${#pids[@]} > 0)); then
    for pid in "${pids[@]}"; do
      if ! is_lobby_process "$pid"; then
        echo "Port ${PORT} is already in use by $(process_field Name "$pid") $(process_field CommandLine "$pid")." >&2
        exit 1
      fi
    done
    echo "Lobby is already listening on port ${PORT} (pid ${pids[*]})."
    return 0
  fi

  echo "Building frontend..."
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm run build

  node_win="$(cygpath -w "$(command -v node)")"
  [[ "$node_win" == *.exe ]] || node_win="${node_win}.exe"
  win_root="$(cygpath -w "$ROOT")"
  out_log="$(cygpath -w "$ROOT/lobby.log")"
  err_log="$(cygpath -w "$ROOT/lobby.err.log")"

  pid="$(PORT="$PORT" powershell.exe -NoProfile -Command "\$env:PORT='${PORT}'; \$p = Start-Process -FilePath '${node_win}' -ArgumentList 'server.js' -WorkingDirectory '${win_root}' -WindowStyle Hidden -RedirectStandardOutput '${out_log}' -RedirectStandardError '${err_log}' -PassThru; Write-Output \$p.Id")"
  pid="$(printf '%s' "$pid" | tr -cd '0-9')"
  if [[ -z "$pid" ]]; then
    echo "Could not start the lobby process." >&2
    exit 1
  fi
  printf '%s\n' "$pid" >"$PID_FILE"

  if ! wait_for_lobby; then
    echo "Lobby process ${pid} did not answer on http://127.0.0.1:${PORT}/." >&2
    exit 1
  fi
  echo "Lobby listening at http://127.0.0.1:${PORT}/ (pid ${pid})."
}

start_funnel() {
  local status targets=() target foreign=0 output code after
  status="$(funnel_status)"
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    targets+=("$target")
  done < <(proxy_targets "$status")

  if ((${#targets[@]} > 0)); then
    for target in "${targets[@]}"; do
      if ! is_lobby_proxy "$target"; then
        foreign=1
      fi
    done
    if (( foreign )); then
      echo "Another Funnel service is already running. Leaving it alone:"
      printf '%s\n' "$status"
      exit 1
    fi
    echo "Funnel is already serving this lobby."
    printf '%s\n' "$status"
    return 0
  fi

  set +e
  output="$(run_timeout 20 tailscale funnel --bg "$PORT")"
  code=$?
  set -e
  if [[ -n "$output" ]]; then
    printf '%s\n' "$output"
  fi
  if [[ "$output" =~ https://login\.tailscale\.com/[^[:space:]]+ ]]; then
    echo "Approve Funnel in the browser, then run this script again."
    exit 2
  fi
  if (( code == 124 )); then
    echo "tailscale funnel --bg ${PORT} did not finish." >&2
    exit 1
  fi
  if (( code != 0 )); then
    echo "tailscale funnel failed." >&2
    exit 1
  fi

  after="$(funnel_status)"
  targets=()
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    targets+=("$target")
  done < <(proxy_targets "$after")
  if ((${#targets[@]} != 1)) || ! is_lobby_proxy "${targets[0]}"; then
    echo "Funnel did not stay limited to this lobby:" >&2
    printf '%s\n' "$after" >&2
    exit 1
  fi
  printf '%s\n' "$after"
}

[[ $# -eq 1 ]] || usage
case "$1" in
  start | stop) ;;
  *) usage ;;
esac

require_tool node
require_tool npm
require_tool tailscale
require_tool powershell.exe
require_tool curl
require_tool cygpath
require_tool taskkill

if [[ "$1" == "stop" ]]; then
  set +e
  stop_funnel
  funnel_code=$?
  set -e
  stop_lobby
  exit "$funnel_code"
else
  start_lobby
  start_funnel
fi
