#!/usr/bin/env bash
# open-tabs.sh — 并行打开多个 tab 并自动验证 URL，输出 shell 变量赋值
#
# 用法：
#   eval $(bash open-tabs.sh "VAR_NAME|URL" "VAR2|URL2" ...)
#
# 示例：
#   eval $(bash open-tabs.sh \
#     "MATERIAL_ID|https://myseller.taobao.com/home.htm/material-center/mine-material/sucai-tu" \
#     "PUBLISH_ID|https://upload.taobao.com/auction/sell.jhtml")
#
# 输出：
#   MATERIAL_ID=DEE5BF4B63E15FA03C3ABC91735FC123
#   PUBLISH_ID=6EC33872F0B8288EC4AA9D288C8C6BE7
#
# 兼容 bash 3.x（macOS 默认）

set -euo pipefail

PROXY="http://localhost:3456"

if [ $# -eq 0 ]; then
  echo "Usage: $0 \"VAR_NAME|URL\" ..." >&2
  exit 1
fi

# 解析参数
VARS=()
URLS=()
KEYS=()

for arg in "$@"; do
  VAR="${arg%%|*}"
  URL="${arg#*|}"
  VARS+=("$VAR")
  URLS+=("$URL")

  # 从 URL 提取多个匹配指纹：路径段 + 域名关键词
  # 页面可能重定向（如 upload.taobao.com/auction → item.upload.taobao.com/sell/ai）
  # 所以同时提取路径段和域名，匹配时任一命中即可

  DOMAIN=$(echo "$URL" | sed -E 's|https?://([^/]+).*|\1|')
  # 域名关键词：取第一段子域（如 myseller.taobao.com → myseller, upload.taobao.com → upload）
  DOMAIN_KEY=$(echo "$DOMAIN" | sed -E 's/\..*//')

  PATH_PART=$(echo "$URL" | sed -E 's|https?://[^/]+/([^?]+).*|\1|')
  FIRST_SEG=$(echo "$PATH_PART" | cut -d'/' -f1 | sed 's/\.htm.*//')
  SECOND_SEG=$(echo "$PATH_PART" | cut -d'/' -f2)

  # 构建匹配模式列表（|分隔），匹配时任一命中即可
  PATTERNS="$DOMAIN_KEY"
  if [ ${#SECOND_SEG} -gt 4 ]; then
    PATTERNS="$PATTERNS|$SECOND_SEG"
  fi
  if [ ${#FIRST_SEG} -gt 4 ] && [ "$FIRST_SEG" != "home" ]; then
    PATTERNS="$PATTERNS|$FIRST_SEG"
  fi

  KEYS+=("$PATTERNS")
done

COUNT=${#VARS[@]}

# 并行打开所有 tab
TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

for url in "${URLS[@]}"; do
  curl -s "${PROXY}/new?url=${url}" >> "$TMPFILE" &
done
wait

# 提取 targetId（40位十六进制）
TARGET_IDS=($(grep -oE '[0-9A-F]{20,}' "$TMPFILE" 2>/dev/null || true))

if [ ${#TARGET_IDS[@]} -ne $COUNT ]; then
  echo "ERROR: expected $COUNT tabs, got ${#TARGET_IDS[@]}" >&2
  exit 1
fi

# 对每个 targetId 获取实际 URL，与预期 KEY 匹配
# 用文件记录匹配结果（避免 bash 3.x 无关联数组）
RESULT_FILE=$(mktemp)
trap "rm -f $TMPFILE $RESULT_FILE" EXIT

for tid in "${TARGET_IDS[@]}"; do
  ACTUAL_URL=$(curl -s -X POST "${PROXY}/eval?target=${tid}" \
    -d 'location.href' 2>/dev/null | sed -n 's/.*"value"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

  for i in $(seq 0 $((COUNT - 1))); do
    VAR="${VARS[$i]}"

    # 跳过已匹配的
    if grep -q "^${VAR}=" "$RESULT_FILE" 2>/dev/null; then
      continue
    fi

    # 用 | 分隔的多个模式尝试匹配
    IFS_OLD="$IFS"
    IFS="|"
    MATCHED=false
    for PATTERN in ${KEYS[$i]}; do
      if [ -n "$PATTERN" ] && echo "$ACTUAL_URL" | grep -qi "$PATTERN"; then
        echo "${VAR}=${tid}" >> "$RESULT_FILE"
        MATCHED=true
        break
      fi
    done
    IFS="$IFS_OLD"
    if [ "$MATCHED" = true ]; then
      break
    fi
  done
done

# 输出结果
ALL_OK=true
for VAR in "${VARS[@]}"; do
  LINE=$(grep "^${VAR}=" "$RESULT_FILE" 2>/dev/null || true)
  if [ -n "$LINE" ]; then
    echo "$LINE"
  else
    echo "${VAR}="
    echo "WARNING: could not match ${VAR}" >&2
    ALL_OK=false
  fi
done

if [ "$ALL_OK" = false ]; then
  exit 1
fi
