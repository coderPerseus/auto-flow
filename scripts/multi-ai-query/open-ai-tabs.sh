#!/bin/bash
# 并行打开多个 AI 服务的标签页

if [ $# -lt 1 ]; then
    echo "用法: $0 <模型1,模型2,模型3,...>"
    echo "示例: $0 chatgpt,gemini,kimi"
    exit 1
fi

models="$1"
IFS=',' read -ra MODEL_ARRAY <<< "$models"

# 获取 CDP 端口
cdp_port="${CDP_PORT:-3456}"

# 打开每个模型的标签页
for model in "${MODEL_ARRAY[@]}"; do
    model=$(echo "$model" | xargs) # 去除空格

    case $model in
        chatgpt)
            url="https://chatgpt.com/"
            ;;
        gemini)
            url="https://gemini.google.com/app"
            ;;
        kimi)
            url="https://www.kimi.com/"
            ;;
        deepseek)
            url="https://chat.deepseek.com/"
            ;;
        qwen)
            url="https://chat.qwen.ai/"
            ;;
        grok)
            url="https://grok.com/"
            ;;
        doubao)
            url="https://www.doubao.com/chat/"
            ;;
        *)
            echo "未知模型: $model，跳过"
            continue
            ;;
    esac

    echo "正在打开: $model -> $url"

    # 使用 CDP Proxy 创建新标签页
    response=$(curl -s "http://localhost:${cdp_port}/new?url=${url}")
    target_id=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -n "$target_id" ]; then
        echo "  ✓ $model 已打开 (target: $target_id)"
    else
        echo "  ✗ $model 打开失败"
    fi
done

echo ""
echo "所有 AI 服务页面已打开"
