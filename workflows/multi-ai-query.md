---
name: multi-ai-query
description: 自动将提问发送给多个 AI 大模型（ChatGPT、Gemini、Kimi、DeepSeek、Qwen、Grok、豆包）
domain: multi-ai
params:
  - name: query
    description: 要发送给 AI 的提问内容
    required: true
  - name: file
    description: 要上传的文件路径（可选）
    required: false
  - name: models
    description: 指定要使用的 AI 模型，不传则使用默认模型
    required: false
created: 2026-03-27
updated: 2026-03-27
---

# multi-ai-query

自动将提问批量发送给多个 AI 大模型，支持 ChatGPT、Gemini、Kimi、DeepSeek、Qwen、Grok、豆包。

## 支持的 AI 服务

| 模型     | URL               | 输入框特征                              | 上传按钮                    | 发送方式             |
| -------- | ----------------- | --------------------------------------- | --------------------------- | -------------------- |
| ChatGPT  | chatgpt.com       | textbox "Chat with ChatGPT"             | button "Add files and more" | Enter 或点击发送按钮 |
| Gemini   | gemini.google.com | textbox "为 Gemini 输入提示"            | button "打开文件上传菜单"   | Enter 或点击发送按钮 |
| Kimi     | kimi.com          | textbox (placeholder "Ask Anything...") | 输入框左侧回形针图标        | Enter 或点击发送按钮 |
| DeepSeek | chat.deepseek.com | textbox "Message DeepSeek"              | button (ref=e18) 附件图标   | Enter 或点击发送按钮 |
| Qwen     | chat.qwen.ai      | textbox "How can I help you today?"     | generic "Upload Image"      | Enter 或点击发送按钮 |
| Grok     | grok.com          | generic contenteditable                 | button "Attach"             | Enter 或点击发送按钮 |
| 豆包     | doubao.com        | textbox "发消息..."                     | 输入框左侧加号图标          | Enter 或点击发送按钮 |

## 前置条件

- 已登录各 AI 服务的账号
- Chrome 已开启远程调试
- agent-browser 已连接

## 首次使用配置

首次使用会提示用户选择默认模型，配置保存在 `~/.config/multi-ai-query/config.json`。

## Steps

### Step 1: 检查配置并确定模型列表

**command**: `bash ${CLAUDE_SKILL_DIR}/scripts/multi-ai-query/check-ai-config.sh`
**description**: 检查用户配置文件，如果没有配置则引导用户选择默认模型。读取 `~/.config/multi-ai-query/config.json` 获取默认模型列表。如果用户传入了 models 参数，优先使用用户指定的模型。
**verify**: 获取到最终的模型列表（至少一个）

### Step 2: 创建浏览器分组（必选）

**command**: `agent-browser eval 'JSON.stringify(await (await fetch("http://localhost:9222/json")).json())'`
**description**: 使用 CDP API 创建一个新的 tab group，用于组织所有 AI 服务的标签页。如果浏览器不支持分组，则跳过此步骤。
**verify**: 成功创建 group 或确认不支持分组功能

### Step 3: 并行打开所有 AI 服务页面

**command**: `bash ${CLAUDE_SKILL_DIR}/scripts/multi-ai-query/open-ai-tabs.sh "model1,model2,model3"`
**description**: 根据确定的模型列表，并行打开所有 AI 服务的网页。每个模型一个独立的 tab。支持的模型：chatgpt, gemini, kimi, deepseek, qwen, grok, doubao。
**verify**: 所有指定的 AI 服务页面已打开（检查 URL）

### Step 4: 向 ChatGPT 发送提问

**command**: `agent-browser open https://chatgpt.com/`
**description**: 打开 ChatGPT 页面，在输入框填入提问内容。输入框是 textbox "Chat with ChatGPT"。如有文件需要上传，先点击 "Add files and more" 按钮上传，然后输入内容并按 Enter 发送。
**verify**: 页面 URL 包含 chatgpt.com，消息已发送（出现用户消息气泡）

### Step 5: 向 Gemini 发送提问

**command**: `agent-browser open https://gemini.google.com/app`
**description**: 打开 Gemini 页面，在输入框填入提问内容。输入框是 textbox "为 Gemini 输入提示"。如有文件需要上传，点击 "打开文件上传菜单" 按钮，选择文件后输入内容发送。
**verify**: 页面 URL 包含 gemini.google.com，消息已发送

### Step 6: 向 Kimi 发送提问

**command**: `agent-browser open https://www.kimi.com/`
**description**: 打开 Kimi 页面，在输入框填入提问内容。输入框是底部的 textbox。如有文件需要上传，点击输入框左侧的回形针图标，选择文件后输入内容按 Enter 发送。
**verify**: 页面 URL 包含 kimi.com，消息已发送

### Step 7: 向 DeepSeek 发送提问

**command**: `agent-browser open https://chat.deepseek.com/`
**description**: 打开 DeepSeek 页面，在输入框填入提问内容。输入框是 textbox "Message DeepSeek"。如有文件需要上传，点击输入框左侧的附件图标，选择文件后输入内容发送。
**verify**: 页面 URL 包含 chat.deepseek.com，消息已发送

### Step 8: 向 Qwen 发送提问

**command**: `agent-browser open https://chat.qwen.ai/`
**description**: 打开 Qwen 页面，在输入框填入提问内容。输入框是 textbox "How can I help you today?"。如有文件需要上传，点击 "Upload Image" 区域，选择文件后输入内容发送。
**verify**: 页面 URL 包含 chat.qwen.ai，消息已发送

### Step 9: 向 Grok 发送提问

**command**: `agent-browser open https://grok.com/`
**description**: 打开 Grok 页面，在输入框填入提问内容。输入框是 contenteditable 区域。如有文件需要上传，点击 "Attach" 按钮，选择文件后输入内容按 Enter 发送。
**verify**: 页面 URL 包含 grok.com，消息已发送

### Step 10: 向豆包发送提问

**command**: `agent-browser open https://www.doubao.com/chat/`
**description**: 打开豆包页面，在输入框填入提问内容。输入框是 textbox "发消息..."。如有文件需要上传，点击输入框左侧的加号图标，选择文件后输入内容发送。
**verify**: 页面 URL 包含 doubao.com，消息已发送

### Step 11: 完成通知

**command**: `echo "所有提问已发送完成"`
**description**: 向用户汇报所有 AI 服务的提问发送状态，列出成功和失败的模型。
**verify**: 用户收到完成通知

## 配置管理

### 修改默认模型

运行以下命令修改默认模型：

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/multi-ai-query/config-ai-models.sh
```

或通过直接编辑配置文件：

```bash
~/.config/multi-ai-query/config.json
```

配置格式：

```json
{
  "default_models": ["chatgpt", "gemini", "kimi", "deepseek"],
  "all_models": {
    "chatgpt": { "name": "ChatGPT", "url": "https://chatgpt.com/" },
    "gemini": { "name": "Gemini", "url": "https://gemini.google.com/app" },
    "kimi": { "name": "Kimi", "url": "https://www.kimi.com/" },
    "deepseek": { "name": "DeepSeek", "url": "https://chat.deepseek.com/" },
    "qwen": { "name": "Qwen", "url": "https://chat.qwen.ai/" },
    "grok": { "name": "Grok", "url": "https://grok.com/" },
    "doubao": { "name": "豆包", "url": "https://www.doubao.com/chat/" }
  }
}
```
