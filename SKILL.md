---
name: auto-flow
license: MIT
description:
  基于 agent-browser 和 CDP 的浏览器自动化 workflow 技能。创建、管理、执行可复用的浏览器操作流程。
  触发场景：用户要求创建 workflow、执行 workflow、更新 workflow、列出 workflow，或描述一个需要在浏览器中重复执行的操作流程。
metadata:
  author: luckySnail
  version: "1.1.0"
---

# auto-flow Skill

基于 agent-browser 和 CDP 的浏览器 workflow 自动化。将浏览器操作沉淀为可复用的 workflow，后续一键执行。

## 前置检查

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/check-deps.sh
```

- **Node.js 22+**：必需（使用原生 WebSocket），如果没有安装先尝试自动安装
- **Chrome remote-debugging**：在 Chrome 地址栏打开 `chrome://inspect/#remote-debugging`，勾选 **"Allow remote debugging for this browser instance"**，可能需要重启浏览器
- **agent-browser**：`npm i -g agent-browser` ,需要检测是否已经是最新版本（npm ls -g agent-browser --depth=0; npm view agent-browser version），如果不是最新版本需要更新(npm install -g agent-browser@latest)

检查通过后再执行操作，未通过则引导用户完成设置。

## 已有 Workflow

| 名称                | 描述                                                                                | 适用站点            | 更新日期   |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------- | ---------- |
| 千牛上传素材        | 打开千牛后台素材中心，上传本地文件到我的图片/视频                                   | myseller.taobao.com | 2026-03-29 |
| multi-ai-query      | 自动将提问发送给多个 AI 大模型（ChatGPT、Gemini、Kimi、DeepSeek、Qwen、Grok、豆包） | multi-ai            | 2026-03-29 |
| x-article-translate | 将 X(Twitter) 文章链接转为本地 Markdown，图片同步到图床                             | x.com               | 2026-03-30 |

## 浏览哲学

**像人一样思考，兼顾高效与适应性的完成任务。**

执行任务时不会过度依赖固有印象所规划的步骤，而是带着目标进入，边看边判断，遇到阻碍就解决，发现内容不够就深入——全程围绕「我要达成什么」做决策。这个 skill 的所有行为都应遵循这个逻辑。

**① 拿到请求** — 先明确用户要做什么，定义成功标准：什么算完成了？需要获取什么信息、执行什么操作、达到什么结果？这是后续所有判断的锚点。

**② 选择起点** — 根据任务性质、平台特征、达成条件，选一个最可能直达的方式作为第一步去验证。一次成功当然最好；不成功则在③中调整。

**③ 过程校验** — 每一步的结果都是证据，不只是成功或失败的二元信号。用结果对照①的成功标准，更新你对目标的判断：路径在推进吗？发现方向错了立即调整，不在同一个方式上反复重试——搜索没命中不等于"还没找对方法"，也可能是"目标不存在"；API 报错、页面缺少预期元素、重试无改善，都是在告诉你该重新评估方向。遇到弹窗、登录墙等障碍，判断它是否真的挡住了目标：挡住了就处理，没挡住就绕过——内容可能已在页面 DOM 中，交互只是展示手段。

**④ 完成判断** — 对照定义的任务成功标准，确认任务完成后才停止，但也不要过度操作，不为了"完整"而浪费代价。

## 核心理念

**Workflow = 对话验证 → 结构化沉淀 → 可靠重放 → 执行进化。**

这个 skill 做四件事：

1. **创建** — 通过对话逐步走通一个浏览器操作流程，每一步记录精确命令 + 自然语言描述 + 验证条件，保存为 workflow 文件
2. **执行** — 读取 workflow 文件，按步骤自动执行，失败时 AI 根据描述 + 页面状态自主恢复
3. **进化** — 每次执行后复盘，将兜底中验证有效的操作回写 workflow，让它越用越准
4. **重建** — 页面大幅改版导致多数步骤失效时，重新走通创建流程

所有浏览器操作都在用户日常 Chrome 中进行，天然携带登录态。操作要求：不主动操作用户已有 tab，所有操作在自己创建的 tab 中完成（必须）。

## 浏览器操作基础

有两种操作浏览器的方式，根据场景选择或混合使用：

| 方式                      | 适用场景                             | 优势                                                     |
| ------------------------- | ------------------------------------ | -------------------------------------------------------- |
| **agent-browser**（CLI）  | 表单填写、多步交互、页面结构探索     | snapshot/ref 模式，AI 直接"看到"页面结构，无需手写选择器 |
| **CDP Proxy**（curl API） | 精确 JS 执行、DOM 操作、批量数据提取 | 精确控制 DOM，适合程序化操作                             |

两者共享同一个 Chrome 实例和登录态，可在同一任务中混合使用。

### agent-browser（推荐，交互类操作首选）

核心循环：`snapshot → 识别 @ref → 操作 → 再 snapshot`

```bash
# 连接用户 Chrome（确保先关掉 agent-browser 自带的 headless 实例）
agent-browser close 2>/dev/null; agent-browser connect <ws-url>

# 核心操作
agent-browser open <url>                # 打开页面
agent-browser wait --load networkidle   # 等待加载
agent-browser snapshot -i               # 获取可交互元素（带 @e1, @e2...）
agent-browser click @e1                 # 通过 @ref 点击
agent-browser fill @e2 "text"           # 通过 @ref 填写
agent-browser snapshot -i               # 页面变化后必须重新 snapshot

# 辅助
agent-browser get text @e1              # 获取元素文本
agent-browser get url                   # 当前 URL
agent-browser screenshot [path]         # 截屏
agent-browser screenshot --annotate     # 带标注截屏
agent-browser tab list                  # 列出标签页
agent-browser scroll down 500           # 滚动
agent-browser eval 'JS表达式'            # 执行 JS（部分元素不在可访问性树中时用）
```

**关键**：`@ref` 在页面变化后失效，操作后必须重新 `snapshot`。

**连接方式**：需用完整 WebSocket URL，从 `~/Library/Application Support/Google/Chrome/DevToolsActivePort` 获取。详见 `references/agent-browser.md`。

### CDP Proxy（精确控制）

启动后通过 curl 调用 HTTP API：

```bash
# 启动（check-deps.sh 会自动启动）
bash ${CLAUDE_SKILL_DIR}/scripts/check-deps.sh

# 常用操作
curl -s "http://localhost:3456/new?url=URL"                          # 新建 tab
curl -s "http://localhost:3456/targets"                               # 列出 tab
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'JS代码'    # 执行 JS
curl -s -X POST "http://localhost:3456/click?target=ID" -d 'CSS选择器' # 点击
curl -s -X POST "http://localhost:3456/clickAt?target=ID" -d 'CSS选择器' # 真实鼠标点击
curl -s -X POST "http://localhost:3456/setFiles?target=ID" \
  -d '{"selector":"input[type=file]","files":["/path/to/file.png"]}'  # 文件上传
curl -s "http://localhost:3456/screenshot?target=ID&file=/tmp/shot.png" # 截图
curl -s "http://localhost:3456/scroll?target=ID&direction=bottom"     # 滚动
curl -s "http://localhost:3456/navigate?target=ID&url=URL"            # 导航
curl -s "http://localhost:3456/close?target=ID"                       # 关闭 tab
```

完整 API 参考见 `references/cdp-api.md`。

### 程序化操作与 GUI 交互

浏览器内操作页面有两种方式：

- **程序化方式**（构造 URL 直接导航、eval 操作 DOM）：成功时速度快、精确，但对网站来说不是正常用户行为，更容易触发反爬机制。
- **GUI 交互**（点击按钮、填写输入框、滚动浏览）：GUI 是为人设计的，网站不会限制正常的 UI 操作，确定性最高，但步骤多、速度慢。

根据对目标平台的了解来判断。当程序化方式受阻时，GUI 交互是可靠的兜底。

进入浏览器层后，`/eval` 就是你的眼睛和手：

- **看**：用 `/eval` 查询 DOM，发现页面上的链接、按钮、表单、文本内容——相当于「看看这个页面有什么」
- **做**：用 `/click` 点击元素、`/scroll` 滚动加载、`/eval` 填表提交——像人一样在页面内自然导航
- **读**：用 `/eval` 提取文字内容，判断图片/视频是否承载核心信息——是则提取媒体 URL 定向读取或 `/screenshot` 视觉识别

浏览网页时，**先了解页面结构，再决定下一步动作**。不需要提前规划所有步骤。

### 技术事实

- 页面中存在大量已加载但未展示的内容——轮播中非当前帧的图片、折叠区块的文字、懒加载占位元素等，它们存在于 DOM 中但对用户不可见。以数据结构（容器、属性、节点关系）为单位思考，可以直接触达这些内容。
- DOM 中存在选择器不可跨越的边界（Shadow DOM 的 `shadowRoot`、iframe 的 `contentDocument`等）。eval 递归遍历可一次穿透所有层级，返回带标签的结构化内容，适合快速了解未知页面的完整结构。
- `/scroll` 到底部会触发懒加载，使未进入视口的图片完成加载。提取图片 URL 前若未滚动，部分图片可能尚未加载。
- **站点内 URL 的可靠性**：站点自己生成的链接（DOM 中的 href）天然携带平台所需的完整上下文，而手动构造的 URL 可能缺失隐式必要参数，导致被拦截、返回错误页面、甚至触发反爬。当构造的 URL 出现这类异常时，应考虑是否是缺失参数所致。
- 平台返回的"内容不存在""页面不见了"等提示不一定反映真实状态，也可能是访问方式的问题（如 URL 缺失必要参数、触发反爬）而非内容本身的问题。
- 短时间内密集打开大量页面（如批量 `/new`）可能触发网站的反爬风控。
- **部分元素不在可访问性树中**：某些 UI 框架渲染的元素不出现在 snapshot 中，改用 eval 查询 DOM。

### 页面内导航

两种方式打开页面内的链接：

- **`/click`**：在当前 tab 内直接点击，简单直接，串行处理。适合需要在同一页面内连续操作的场景，如点击展开、翻页、进入详情等。
- **`/new` + 完整 URL**：从 DOM 提取对象链接的完整地址（包含所有查询参数），在新 tab 中打开。适合需要同时访问多个页面的场景。

很多网站的链接包含会话相关的参数（如 token），这些参数是正常访问所必需的。提取 URL 时应保留完整地址，不要裁剪或省略参数。

### 登录判断

用户日常 Chrome 天然携带登录态，大多数常用网站已登录。

登录判断的核心问题只有一个：**目标内容拿到了吗？**

打开页面后先尝试获取目标内容。只有当确认**目标内容无法获取**且判断登录能解决时，才告知用户：

> "当前页面在未登录状态下无法获取[具体内容]，请在你的 Chrome 中登录 [网站名]，完成后告诉我继续。"

登录完成后无需重启任何东西，直接刷新页面继续。

### 任务结束

关闭自己创建的 tab，保留用户原有 tab 不受影响。Proxy 持续运行，不主动停止。

### 禁止

- 禁止修改当前用户大家的tab
- 禁止关闭浏览器，重启浏览器登危险动作

## Workflow 系统

### 文件结构

Workflow 存储在 `workflows/` 下，每个文件一个 workflow。

**Workflow 生成的文件**（Markdown、截图、下载文件、临时数据等）统一存放在 `temp/` 目录下，按 workflow 名称分子目录：

```
temp/
├── {workflow-name}/
│   ├── *.md            # workflow 产出的最终文档
│   ├── screenshots/     # 执行过程中的截图
│   ├── downloads/       # 下载的文件
│   └── logs/            # 执行日志
```

默认输出必须落在 `temp/{workflow-name}/` 下。除非用户指定了文件存放的位置 。任务结束后保留文件供用户查看，不主动清理。

#### Workflow 文件格式

```markdown
---
name: workflow 名称
description: 一句话描述
domain: 适用站点
params: # 可选：workflow 参数
  - name: param_name
    description: 参数说明
    required: true
created: 2026-03-27
updated: 2026-03-27
---

# workflow 名称

## 前置条件

- 已登录 xxx
- 需要准备的素材/数据

## Steps

### Step 1: 步骤名称

**command**: `agent-browser 具体命令`
**description**: 自然语言描述这一步做什么，当 command 失败时 AI 根据这段描述 + 当前页面状态自主完成
**verify**: 成功条件（URL 包含 xxx、页面出现"xxx"文字、某元素可见）

### Step 2: 步骤名称

**command**: `agent-browser 具体命令`
**description**: 自然语言描述
**verify**: 验证条件
```

模板文件：`workflows/_template.md`

### 创建 workflow

用户说"创建 workflow"或描述一个需要沉淀的操作流程时，进入创建模式：

**① 明确目标** — 确认：

- workflow 名称（英文短横线命名，如 `qianniu-upload-material`）
- 适用场景和目标网站
- 前置条件（登录态、素材准备等）
- 是否需要参数化（每次执行时变化的输入，如文件路径、文本内容）

**② 逐步走通** — 在浏览器中一步步操作，每完成一步记录：

- `command`：实际执行成功的 agent-browser / CDP 命令
- `description`：这一步在做什么、目标是什么（要足够详细，AI 兜底时靠它理解意图）
- `verify`：如何判断这一步成功了（尽量用客观可检测的条件：URL 变化、元素出现、文本包含）

**③ 保存文件** — 全部走通后写入 `workflows/{name}.md`

**创建时的原则：**

- 每一步都必须实际在浏览器中验证通过，不凭想象写命令
- description 要写给"不了解这个页面的 AI"看——不能假设它知道页面布局
- verify 条件要客观可检测，避免模糊描述
- 如果某些元素不在可访问性树中（snapshot 找不到），在 description 中注明，并在 command 中用 eval 方式操作

### 执行 workflow

用户要求执行某个 workflow 时：

**① 准备** — 读取 workflow 文件，确认前置条件，收集所需参数

**② 逐步执行** — 按 step 顺序执行，每步遵循：

```
command 成功 → verify 通过 → 下一步
command 失败 ──┐
verify 不通过 ─┤→ AI 读取 description + snapshot 当前页面 → 自主操作 → 再 verify
```

**③ 兜底恢复** — 当 command 失败或 verify 不通过时：

1. 重新 `snapshot` 获取当前页面状态
2. 对照 description 理解这一步的目标
3. 根据实际页面结构自主决定操作方式（点击其他元素、用 eval 操作 DOM 等）
4. 操作后再次 verify

**④ 完成确认** — 所有 step 完成后，确认最终状态符合预期

**⑤ 执行复盘** — workflow 执行结束后（无论成功或失败），进入复盘阶段，评估是否需要更新 workflow。详见下方「执行后自进化」。

**执行时的原则：**

- 不要跳过任何 step，即使看起来"已经在正确位置"
- 每一步的 verify 必须通过才能进入下一步
- 兜底时不要盲目重试同一个命令，要看页面实际状态再决定
- 如果某个 step 连续兜底 3 次仍失败，停下来向用户报告当前状态
- **记录兜底事件**：每次兜底恢复成功时，记住哪个 step、原始 command 为什么失败、实际用了什么方式修复。这些是复盘的输入

### 执行后自进化

**每次执行完毕后必须进入此阶段。** Workflow 的价值在于越用越准——执行中遇到的问题不是一次性事件，而是改进信号。

#### 复盘流程

**① 回顾执行记录** — 逐 step 检查：

- 哪些 step 的 command 一次成功？（无需改动）
- 哪些 step 触发了兜底？原因是什么？
- 兜底修复用了什么方式？是否比原 command 更可靠？

**② 评估严重性** — 对每个兜底事件判断：

| 严重性           | 特征                                                                     | 处理方式                                      |
| ---------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| **高：必须更新** | command 执行报错（选择器失效、元素不存在、API 变更）；每次执行大概率复现 | 立即更新 step 的 command 和 description       |
| **中：建议更新** | command 成功但 verify 不通过（页面结构微调、时序问题）；兜底方案明显更优 | 更新 command，在 description 中补充新发现     |
| **低：记录观察** | 偶发性问题（网络延迟、一次性弹窗）；兜底后原路径仍可用                   | 不改 command，但在 description 中追加注意事项 |
| **无需处理**     | 全部 step 一次通过                                                       | 不做任何改动                                  |

**③ 执行更新** — 根据评估结果：

- **更新 command**：将兜底时验证有效的操作写入 command 字段，替换失效的旧命令
- **丰富 description**：补充执行中发现的新信息（实际选择器位置、元素不在可访问性树中、需要 eval 的原因等），让下次兜底更高效
- **调整 verify**：如果验证条件不够准确（误判通过/不通过），修正为更精确的条件
- **更新 frontmatter**：`updated` 改为当前日期
- **站点经验联动**：如果发现了平台级规律（如"千牛侧边栏不在可访问性树中"），同步写入 `references/site-patterns/{domain}.md`

**④ 判断是否需要重建** — 如果单次执行中 **超过半数 step 触发兜底**，说明页面可能已大幅改版，此时：

- 向用户建议重新走一遍创建流程
- 将当前文件标注 `deprecated: true`，保留作为参考
- 创建新版 workflow

#### 进化原则

- **只写验证过的事实**：更新的 command 必须是本次执行中实际成功的操作，不猜测、不泛化
- **保留兜底能力**：command 变了但 description 的自然语言描述必须保持完整——它是最后的兜底依据，不能因为 command 更新了就简化 description
- **渐进式改进**：每次执行只更新本次发现的问题，不主动重构未出问题的 step
- **向用户透明**：复盘结束后，简要告知用户做了哪些更新及原因（一两句话即可，不需要冗长报告）

### 列出 workflow

用户问"有哪些 workflow"时：

```bash
ls ${CLAUDE_SKILL_DIR}/workflows/*.md | grep -v _template
```

读取每个文件的 frontmatter，展示：名称、描述、适用域名、最后更新日期。

### 删除 workflow

用户要求删除时，确认 workflow 名称后删除文件。如果不确定，标注 `deprecated: true` 而非直接删除。

## 并行执行

当一个 workflow 的多个 step 相互独立时（如同时打开多个页面提取数据），可以分发给子 Agent 并行执行。

每个子 Agent 自行创建后台 tab（`/new`），自行操作，任务结束自行关闭（`/close`）。所有子 Agent 共享一个 Chrome、一个 Proxy，通过不同 targetId 操作不同 tab，无竞态风险。

**子 Agent Prompt 写法：目标导向，而非步骤指令**

- 必须在子 Agent prompt 中写 `必须加载 auto-flow skill 并遵循指引`，子 Agent 会自动加载 skill，无需在 prompt 中复制 skill 内容或指定路径。
- 子 Agent 有自主判断能力。主 Agent 的职责是说清楚**要什么**，仅在必要与确信时限定**怎么做**。过度指定步骤会剥夺子 Agent 的判断空间，反而引入主 Agent 的假设错误。**避免 prompt 用词对子 Agent 行为的暗示**：「搜索xx」会把子 Agent 锚定到 WebSearch，而实际上有些反爬站点需要 CDP 直接访问主站才能有效获取内容。主 Agent 写 prompt 时应描述目标（「获取」「调研」「了解」），避免用暗示具体手段的动词（「搜索」「抓取」「爬取」）。

## 站点经验

操作中积累的特定网站经验，按域名存储在 `references/site-patterns/` 下。

已有经验的站点：!`ls ${CLAUDE_SKILL_DIR}/references/site-patterns/ 2>/dev/null | sed 's/\.md$//' || echo "暂无"`

确定目标网站后，如果有匹配的站点经验，必须读取对应文件获取先验知识。操作成功后，如果发现了值得记录的新模式，主动写入站点经验文件。

文件格式：

```markdown
---
domain: example.com
aliases: [示例, Example]
updated: 2026-03-27
---

## 平台特征

架构、反爬行为、登录需求、内容加载方式等

## 有效模式

已验证的 URL 模式、操作策略、选择器

## 已知陷阱

什么会失败以及为什么（标注发现日期）
```

## References 索引

| 文件                                   | 何时加载                           |
| -------------------------------------- | ---------------------------------- |
| `references/cdp-api.md`                | 需要 CDP Proxy API 详细参考时      |
| `references/agent-browser.md`          | agent-browser 连接或操作遇到问题时 |
| `references/site-patterns/{domain}.md` | 确定目标网站后，读取对应站点经验   |
| `workflows/_template.md`               | 创建新 workflow 时，参考模板格式   |
