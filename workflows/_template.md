---
name: workflow 名称
description: 一句话描述这个 workflow 做什么
domain: example.com
created: 2026-03-27
updated: 2026-03-27
---

# workflow 名称

## 前置条件

- 已登录 example.com
- 需要准备的素材/数据

## Steps

### Step 1: 步骤名称

**command**: `agent-browser 命令`
**description**: 自然语言描述这一步要做什么，当 command 失败时 AI 根据这段描述 + 当前页面状态自主完成
**verify**: 验证条件（如：URL 包含 /xxx，页面出现"xxx"文字，某元素可见）

### Step 2: 步骤名称

**command**: `agent-browser 命令`
**description**: 自然语言描述
**verify**: 验证条件
