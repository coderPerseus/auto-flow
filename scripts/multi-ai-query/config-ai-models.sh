#!/bin/bash
# 配置多 AI 查询的默认模型

CONFIG_DIR="$HOME/.config/multi-ai-query"
CONFIG_FILE="$CONFIG_DIR/config.json"

# 确保配置目录存在
mkdir -p "$CONFIG_DIR"

# 所有可用的模型
all_models=(
    "chatgpt:ChatGPT"
    "gemini:Gemini"
    "kimi:Kimi"
    "deepseek:DeepSeek"
    "qwen:Qwen (通义千问)"
    "grok:Grok"
    "doubao:豆包"
)

echo "========================================"
echo "   配置多 AI 查询默认模型"
echo "========================================"
echo ""
echo "可用模型列表:"
echo ""

for i in "${!all_models[@]}"; do
    IFS=':' read -r key name <<< "${all_models[$i]}"
    echo "  [$((i+1))] $name"
done

echo ""
echo "请输入要设为默认的模型编号（用空格分隔，如: 1 2 3 4）:"
read -r selections

# 处理用户选择
selected_models=()
for sel in $selections; do
    idx=$((sel - 1))
    if [ "$idx" -ge 0 ] && [ "$idx" -lt "${#all_models[@]}" ]; then
        IFS=':' read -r key name <<< "${all_models[$idx]}"
        selected_models+=("$key")
    fi
done

if [ ${#selected_models[@]} -eq 0 ]; then
    echo "未选择任何模型，保持原有配置"
    exit 0
fi

# 生成新配置
config_content="{"
config_content+='\n  "default_models": ['
for i in "${!selected_models[@]}"; do
    if [ $i -gt 0 ]; then
        config_content+=","
    fi
    config_content+='\n    "'${selected_models[$i]}'"'
done
config_content+='\n  ],'
config_content+='\n  "all_models": {'
config_content+='\n    "chatgpt": { "name": "ChatGPT", "url": "https://chatgpt.com/" },'
config_content+='\n    "gemini": { "name": "Gemini", "url": "https://gemini.google.com/app" },'
config_content+='\n    "kimi": { "name": "Kimi", "url": "https://www.kimi.com/" },'
config_content+='\n    "deepseek": { "name": "DeepSeek", "url": "https://chat.deepseek.com/" },'
config_content+='\n    "qwen": { "name": "Qwen", "url": "https://chat.qwen.ai/" },'
config_content+='\n    "grok": { "name": "Grok", "url": "https://grok.com/" },'
config_content+='\n    "doubao": { "name": "豆包", "url": "https://www.doubao.com/chat/" }'
config_content+='\n  }'
config_content+='\n}'

echo -e "$config_content" > "$CONFIG_FILE"

echo ""
echo "✓ 配置已保存到: $CONFIG_FILE"
echo ""
echo "当前默认模型:"
for model in "${selected_models[@]}"; do
    case $model in
        chatgpt) echo "  ✓ ChatGPT" ;;
        gemini) echo "  ✓ Gemini" ;;
        kimi) echo "  ✓ Kimi" ;;
        deepseek) echo "  ✓ DeepSeek" ;;
        qwen) echo "  ✓ Qwen" ;;
        grok) echo "  ✓ Grok" ;;
        doubao) echo "  ✓ 豆包" ;;
    esac
done
