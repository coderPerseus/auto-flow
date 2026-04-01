#!/usr/bin/env bash
# 环境检查 + 确保 CDP Proxy 就绪

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version 2>/dev/null)
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
    echo "node: ok ($NODE_VER)"
  else
    echo "node: warn ($NODE_VER, 建议升级到 22+)"
  fi
else
  echo "node: missing — 请安装 Node.js 22+"
  exit 1
fi

# Chrome 调试端点 — 自动发现并缓存，不要求用户手动报告 host/port
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! eval "$(node "$SCRIPT_DIR/discover-chrome-debug.mjs" --shell 2>/dev/null)"; then
  echo "chrome: not connected — 请打开 chrome://inspect/#remote-debugging 并勾选 Allow remote debugging"
  exit 1
fi
echo "chrome: ok (${CHROME_DEBUG_HOST}:${CHROME_DEBUG_PORT}, ${CHROME_DEBUG_SOURCE})"

# CDP Proxy — 用 /targets 统一判断：返回 JSON 数组即 ready，失败则启动并重试
TARGETS=$(curl -s --connect-timeout 3 "http://127.0.0.1:3456/targets" 2>/dev/null)
if echo "$TARGETS" | grep -q '^\['; then
  echo "proxy: ready"
else
  # /targets 失败：proxy 未运行或未连接 Chrome，尝试启动（已运行会自动跳过）
  echo "proxy: connecting..."
  CHROME_DEBUG_HOST="$CHROME_DEBUG_HOST" \
  CHROME_DEBUG_PORT="$CHROME_DEBUG_PORT" \
  CHROME_DEBUG_WS_PATH="$CHROME_DEBUG_WS_PATH" \
  CHROME_DEBUG_WS_URL="$CHROME_DEBUG_WS_URL" \
  node "$SCRIPT_DIR/cdp-proxy.mjs" > /tmp/cdp-proxy.log 2>&1 &
  sleep 2  # 等 proxy 进程就绪
  for i in $(seq 1 15); do
    # connect-timeout 5s：给 Chrome 授权弹窗留够响应时间，避免超时后重复触发连接
    curl -s --connect-timeout 5 --max-time 8 http://localhost:3456/targets 2>/dev/null | grep -q '^\[' && echo "proxy: ready" && exit 0
    [ $i -eq 1 ] && echo "⚠️  Chrome 可能有授权弹窗，请点击「允许」后等待连接..."
  done
  echo "❌ 连接超时，请检查 Chrome 调试设置"
  exit 1
fi
