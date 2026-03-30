#!/bin/bash
# 检查多 AI 查询的配置文件

CONFIG_DIR="$HOME/.config/multi-ai-query"
CONFIG_FILE="$CONFIG_DIR/config.json"

# 创建配置目录
mkdir -p "$CONFIG_DIR"

# 默认配置
default_config='{
  "default_models": ["chatgpt", "gemini", "kimi", "qwen"],
  "all_models": {
    "chatgpt": { "name": "ChatGPT", "url": "https://chatgpt.com/", "supports_file": true },
    "gemini": { "name": "Gemini", "url": "https://gemini.google.com/app", "supports_file": true },
    "kimi": { "name": "Kimi", "url": "https://www.kimi.com/", "supports_file": true },
    "qwen": { "name": "Qwen", "url": "https://chat.qwen.ai/", "supports_file": true },
    "deepseek": { "name": "DeepSeek", "url": "https://chat.deepseek.com/", "supports_file": false },
    "grok": { "name": "Grok", "url": "https://grok.com/", "supports_file": true },
    "doubao": { "name": "豆包", "url": "https://www.doubao.com/chat/", "supports_file": true }
  }
}'

# 如果配置文件不存在，创建默认配置
if [ ! -f "$CONFIG_FILE" ]; then
    echo "$default_config" > "$CONFIG_FILE"
    echo "✓ 已创建默认配置文件: $CONFIG_FILE"
    echo ""
    echo "默认使用的 AI 模型:"
    echo "  - ChatGPT"
    echo "  - Gemini"
    echo "  - Kimi"
    echo "  - Qwen"
    echo ""
    echo "如需修改默认模型，请运行: bash ${CLAUDE_SKILL_DIR}/scripts/multi-ai-query/config-ai-models.sh"
fi

# 输出配置信息
cat "$CONFIG_FILE"
