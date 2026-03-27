# agent-browser 踩坑经验

## 连接必须用完整 WebSocket URL

`agent-browser connect 9222` 会超时——Chrome 通过 `chrome://inspect` 开启远程调试时，端口不暴露标准 HTTP 端点。

```bash
# 读取完整路径
cat ~/Library/Application\ Support/Google/Chrome/DevToolsActivePort
# 9222
# /devtools/browser/03ff9456-...

# 用完整 URL 连接
agent-browser connect "ws://127.0.0.1:9222/devtools/browser/{id}"
```

## close 不要用 && 串联 connect

`close` 在无实例时返回非零退出码，会阻断后续命令。用 `;` 或分开执行：

```bash
agent-browser close 2>/dev/null; agent-browser connect "ws://..."
```

## 已打开的页面不要再 open

`open` 会触发导航等待 load 事件。SPA 页面（如千牛）可能永远不触发 load 完成，导致超时。用 `tab select` + `snapshot` 代替。

即使 `open` 超时，页面可能已加载完成，可直接 `snapshot` 查看。

## 部分元素不在可访问性树中

某些 UI 框架渲染的元素（如千牛侧边栏导航）不出现在 `snapshot` 中。改用 `eval` 查询 DOM。

## 如果上面所有内容都不能解决问题，尝试查看源码和文档寻找 agent-browser 使用方法

- 源码：https://github.com/vercel-labs/agent-browser
- 文档：https://agent-browser.dev/
