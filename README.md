# auto-flow

基于 agent-browser 和 CDP 的浏览器 workflow 自动化 skill。

将浏览器操作沉淀为可复用的 workflow 文件——通过对话逐步走通流程，记录每一步的精确命令 + 自然语言描述 + 验证条件，后续一键执行。执行时命令失败会自动兜底：AI 根据描述 + 当前页面状态自主恢复。

## 能力

| 能力 | 说明 |
|------|------|
| 创建 workflow | 对话式逐步走通流程，自动记录为结构化 workflow 文件 |
| 执行 workflow | 按步骤自动执行，command → verify → AI 兜底，全程自适应 |
| 维护 workflow | 执行中自动更新失效命令，页面改版时重新创建 |
| 双模式浏览器 | agent-browser（snapshot/ref 交互）+ CDP Proxy（精确 DOM 控制） |
| 站点经验 | 按域名积累操作经验，跨 session 复用 |
| 参数化 | workflow 支持动态参数，每次执行传入不同输入 |

## 安装

```bash
git clone <repo-url> ~/.claude/skills/auto-flow
```

## 前置配置

1. **Node.js 22+**
2. **Chrome 开启远程调试**：地址栏打开 `chrome://inspect/#remote-debugging`，勾选 **Allow remote debugging for this browser instance**
3. **agent-browser**：`npm i -g agent-browser`

运行环境检查：

```bash
bash ~/.claude/skills/auto-flow/scripts/check-deps.sh
```

## 使用

```
# 创建 workflow
"帮我创建一个 workflow：在千牛后台上传素材"

# 执行 workflow
"执行千牛上传素材的 workflow"

# 列出 workflow
"有哪些 workflow？"

# 更新 workflow
"重新走一遍千牛上传素材的流程，更新 workflow"
```

## Workflow 执行机制

每个 step 同时记录精确命令和自然语言描述：

```
command 成功 → verify 通过 → 下一步
command 失败 ──┐
verify 不通过 ─┤→ AI 读取 description + snapshot → 自主操作 → 再 verify
```

命令优先保证速度和确定性，自然语言兜底保证适应性。

## 项目结构

```
SKILL.md                          # Skill 主文件
workflows/                        # Workflow 文件
  _template.md                    # 模板
  qianniu-upload-material.md      # 示例：千牛上传素材
scripts/
  check-deps.sh                   # 环境检查
  cdp-proxy.mjs                   # CDP Proxy 服务
references/
  cdp-api.md                      # CDP API 参考
  agent-browser.md                # agent-browser 踩坑经验
  site-patterns/                  # 站点经验
```

## License

MIT
