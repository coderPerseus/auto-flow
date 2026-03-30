---
name: x-article-translate
description: 将 X(Twitter) 文章链接转为本地 Markdown，并调用 DeepSeek / Gemini 翻译
domain: x.com
params:
  - name: url
    required: true
    description: X 文章链接，如 https://x.com/user/article/123456
  - name: output
    required: false
    description: 输出 Markdown 文件路径，默认当前目录下以文章标题命名
  - name: picgo-config
    required: false
    description: PicGo 配置文件路径，默认自动查找 ~/.picgo/config.json
  - name: provider
    required: false
    description: 翻译供应商，可选 deepseek / gemini。默认读取用户偏好
  - name: model
    required: false
    description: 翻译模型 ID。默认读取用户偏好
  - name: target-language
    required: false
    description: 目标语言，默认中文；如果用户提示词里明确要求其他语言，则以提示词为准
  - name: translation-prompt
    required: false
    description: 翻译附加要求，如“翻译成日文并保留产品名英文”
created: 2026-03-30
updated: 2026-03-30
---

# X 文章翻译为 Markdown

将 X 平台的 Article 页面完整转为本地 Markdown，所有图片上传到 PicGo 配置的图床，嵌入的推文/Article 截图后也上传到图床；随后接入 DeepSeek / Gemini 完成译文输出。

## 前置条件

- Chrome 已开启远程调试
- 已登录 x.com（部分文章需要登录查看）
- PicGo 已安装并配置图床（或 PicGo Server 运行中）

## 核心脚本

- `scripts/x-article/picgo-upload.mjs` - 图片上传（读取 PicGo 配置，支持 R2/腾讯云直传和 PicGo Server）
- `scripts/x-article/download-image.mjs` - 图片下载到本地临时目录
- `scripts/x-article/config-translation.mjs` - 初始化 / 读取翻译供应商、模型与 API key 偏好
- `scripts/x-article/translate-article.mjs` - 分析文章主题、生成系统提示词、调用模型完成翻译

## Steps

### Step 1: 环境检查

**command**: `bash ${SKILL_DIR}/scripts/check-deps.sh`
**description**: 检查 Node.js、Chrome 调试端口、CDP Proxy 是否就绪
**verify**: 输出包含 "All checks passed" 或所有检查项显示 ✓

### Step 2: 打开 X 文章页面

**command**: `curl -s "http://127.0.0.1:3456/new?url=${URL}"`
**description**: 通过 CDP Proxy 在后台打开 X 文章链接。保存返回的 targetId 供后续步骤使用。
**verify**: 返回 JSON 包含 targetId，无错误

### Step 3: 等待并滚动全页触发懒加载

**command**:
```bash
# 等待页面主体加载完成
sleep 5

# 缓慢滚动全页，确保所有图片和嵌入内容完成懒加载
# X Article 的图片使用 css-9pa8cd 类名，但只有滚动到视口后才会真正加载
for i in $(seq 1 10); do
  curl -s "http://127.0.0.1:3456/scroll?target=${TARGET_ID}&direction=down&times=3" > /dev/null
  sleep 1
done

# 回到顶部准备提取
curl -s "http://127.0.0.1:3456/scroll?target=${TARGET_ID}&direction=top"
```
**description**: X 文章页面有大量懒加载内容。必须缓慢逐段滚动到底部，让每张图片、每条嵌入推文都进入视口完成加载。等待 sleep 5 是因为 X Article 的初始渲染比普通推文慢（Draft.js 富文本编辑器渲染）。滚动完毕后回到顶部准备提取。注意：如果只做一次快速滚动，部分图片的 src 会是空的或尺寸为 0。
**verify**: 通过 eval 检查 `document.querySelector('article')` 不为 null，且 `document.querySelectorAll('img.css-9pa8cd').length` 大于 0

### Step 4: 提取文章标题和作者

**command**:
```bash
curl -s -X POST "http://127.0.0.1:3456/eval?target=${TARGET_ID}" \
  -d '(() => {
    const bodyText = document.body.innerText.slice(0, 500);
    return JSON.stringify({ bodyStart: bodyText });
  })()'
```
**description**:
X Article 的标题不在 `document.title`（通常为空）也不在 `<h1>` 标签中。标题和作者信息出现在页面顶部的纯文本中，格式为：
```
How I Think About Codex
Gabriel Chua
@gabrielchua
·
Feb 21
```
从 `document.body.innerText` 的前几行中提取标题和作者。标题通常是第一个有意义的文本行（跳过"View keyboard shortcuts"等 UI 文字），作者名在标题下方，@handle 紧随其后。

**verify**: 成功提取出标题和作者名

### Step 5: 提取 Hero 图和所有文章图片

**command**:
```bash
# Step 5a: 提取所有 /media/ 链接（X Article 图片以链接形式存在，不是 <img> 标签）
curl -s -X POST "http://127.0.0.1:3456/eval?target=${TARGET_ID}" \
  -d '(() => {
    const links = document.querySelectorAll("a[href*=\"/media/\"]");
    return JSON.stringify(Array.from(links).map(a => a.href));
  })()'

# Step 5b: 对每个 media 链接，打开获取实际图片 URL
# 注意：需要逐个打开，因为可能有多个图片
MEDIA_URL="https://x.com/gabrielchua/article/2025017553442201807/media/2025011866112798720"
curl -s "http://127.0.0.1:3456/new?url=${MEDIA_URL}"
# 保存返回的 targetId，然后在新标签页中提取实际图片
```
**description**:
**关键发现**：X Article 的图片**不是以 `<img>` 标签渲染的**！它们以占位 div + `/media/xxx` 链接的形式存在。必须打开 media 链接才能获取实际的 `pbs.twimg.com/media/` 图片 URL。

正确流程：
1. **提取 media 链接**：在文章页面中查找所有 `a[href*="/media/"]` 链接
2. **打开 media 页面**：用 CDP `/new` 打开每个 media 链接（会跳转到图片展示页）
3. **提取真实图片**：在 media 页面中查找 `img[src*="pbs.twimg.com/media"]`
4. **优化质量**：将 URL 中的 `name=small|medium` 替换为 `name=orig` 获取原始尺寸
5. **过滤**：排除 `profile_images`（头像）和 `emoji`

**常见错误**：直接在文章页面查 `img.css-9pa8cd` 会漏掉所有文章图片，因为这些图片只是占位 div，没有实际 src。

**verify**: 找到所有 media 链接，每个都能提取到有效的 pbs.twimg.com/media/ URL

### Step 6: 提取文章 HTML 内容

**command**:
```bash
# 提取文章容器的完整 HTML，后续用 turndown 转换
curl -s -X POST "http://127.0.0.1:3456/eval?target=${TARGET_ID}" \
  -d '(() => {
    // 找到包含最多 h2 的容器
    const articleH2Texts = ["My Mental Model", "The Model", "The Harness", "The Surfaces", "Looking Ahead"];
    const allDivs = Array.from(document.querySelectorAll("div"));
    let bestContainer = null;
    let maxH2 = 0;
    for (const d of allDivs) {
      const h2s = d.querySelectorAll("h2");
      if (h2s.length > maxH2) {
        maxH2 = h2s.length;
        bestContainer = d;
      }
    }
    if (!bestContainer) return JSON.stringify({ error: "no container" });

    // 返回 HTML 和图片说明映射
    const captions = {};
    const sections = bestContainer.querySelectorAll("section");
    sections.forEach((s, i) => {
      const text = s.textContent.trim();
      if (text && !s.querySelector("article")) {
        captions[i] = text;
      }
    });

    return JSON.stringify({
      html: bestContainer.innerHTML,
      captions: captions,
      h2Count: maxH2
    });
  })()'
```
**description**:
提取文章容器的完整 HTML，交给 turndown 库转换为 Markdown。

**为什么不手写解析？**
- X Article 使用 Draft.js，样式通过内联 CSS 控制（`style="font-style: italic"` 而非 `<em>`）
- 手写解析容易遗漏边界情况（嵌套样式、特殊字符、链接格式等）
- turndown 是成熟的 HTML→Markdown 转换库，处理了大部分兼容性问题

**提取内容**：
- 找到包含文章内容的容器（包含最多 `<h2>` 的 div）
- 提取容器完整 HTML
- 同时提取图片说明文字（section 内的文字内容）用于后续合并

**verify**: 返回有效的 HTML 字符串和 h2 数量大于 0

### Step 7: 下载图片并上传图床

**description**:
对 Step 5 提取到的每张图片：

```bash
# 1. 优化 URL 质量（替换 name=small 为 name=orig）
OPTIMIZED_URL=$(echo "${IMAGE_SRC}" | sed 's/name=[a-z]*/name=orig/')

# 2. 下载图片到本地
LOCAL_PATH=$(node ${SKILL_DIR}/scripts/x-article/download-image.mjs "${OPTIMIZED_URL}")

# 3. 上传到图床
CDN_URL=$(node ${SKILL_DIR}/scripts/x-article/picgo-upload.mjs "${LOCAL_PATH}" [--picgo-config ${PICGO_CONFIG}])

# 4. 记录映射: 原始pbs.twimg.com URL -> 图床CDN URL
```

可以并行下载和上传以提高效率，但需要保持映射关系的正确性（建议先并行下载，确认文件名后再并行上传，最后按文件名匹配 CDN URL）。

**verify**: 所有图片都有对应的图床 URL，无上传失败

### Step 8: 精确截图嵌入 article 并上传图床

**command**:
```bash
# 1. 激活当前导出脚本创建的 tab，避免后台标签页白图
curl -s "http://127.0.0.1:3456/activate?target=${TARGET_ID}"

# 2. 对指定 section/article 精确截图
node ${SKILL_DIR}/scripts/x-article/capture-article-element.mjs \
  --target "${TARGET_ID}" \
  --output "temp/${WORKFLOW_NAME}/assets/tweetcard-27.png" \
  --status-url "https://x.com/OpenCodeHQ/status/2009803906461905202" \
  --child-index 27

# 3. 上传截图到图床
CDN_URL=$(node ${SKILL_DIR}/scripts/x-article/picgo-upload.mjs "temp/${WORKFLOW_NAME}/assets/tweetcard-27.png" [--picgo-config ${PICGO_CONFIG}])
```
**description**:
嵌入 `article` 的需求不是“拿媒体原图”，而是“把页面里实际渲染出来的 tweet 卡片完整截下来”。因此这里必须做元素级截图，而不是走 tweet 数据接口。

正确流程：
1. 先激活自己创建的目标 tab，避免后台页 `Page.captureScreenshot` 返回白图
2. 在文章内容容器内按 `status URL` 和 `childIndex` 精确定位对应 `section/article`
3. `scrollIntoView({ block: "center" })`，等待字体、头像、内嵌图片 decode 完成
4. 读取 `getBoundingClientRect()`，按元素区域加少量 padding 做 clip 截图
5. 将截图文件上传到图床，Markdown 中引用该截图 URL

注意：
- 不要用全局 `document.querySelectorAll("article")[n]` 作为主定位方式，优先使用内容容器里的 `childIndex` 与 `status URL`
- 之前白图的根因是：后台 tab 截图、元素尚未 paint/decode 完成、没有按目标元素 clip
- 如果截图脚本校验到目标没有真实暴露在视口中，应视为失败并重试，不要上传白图

**verify**: 截图结果包含完整 article 卡片内容，不是白图，不是页面 hero 图，且 block 日志中记录了定位方式与 clip 区域

### Step 9: HTML 转 Markdown（使用 turndown）

**command**:
```bash
# 使用 turndown 将 HTML 转换为 Markdown
node -e "
const TurndownService = require('turndown');
const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
});

// 自定义规则：处理 X Article 的特殊结构
turndownService.addRule('xArticleImage', {
  filter: function (node) {
    return node.nodeName === 'SECTION' && node.querySelector('a[href*="/media/"]');
  },
  replacement: function (content, node) {
    // 图片说明文字
    const caption = content.trim();
    return caption ? '\n\n> ' + caption.replace(/\n/g, ' ') + '\n' : '\n';
  }
});

turndownService.addRule('xArticleTweet', {
  filter: function (node) {
    return node.nodeName === 'SECTION' && node.querySelector('article');
  },
  replacement: function (content) {
    // 嵌入推文占位，后续替换为截图
    return '\n\n[EMBED_TWEET]\n';
  }
});

// 转换 HTML
const html = process.argv[1];
const markdown = turndownService.turndown(html);
console.log(markdown);
" "$HTML_CONTENT"
```
**description**:
使用 [turndown](https://github.com/mixmark-io/turndown) 库将 HTML 转换为 Markdown，保证格式兼容性。

**为什么用 turndown？**
- 成熟稳定，处理了各种边界情况
- 支持自定义规则扩展
- 避免手写解析逻辑遗漏特殊格式

**转换流程：**
1. 安装 turndown: `npm install turndown`
2. 配置 turndown 选项（标题风格、列表标记等）
3. 添加自定义规则处理 X Article 特殊结构：
   - `xArticleImage`: 处理图片 section，提取说明文字
   - `xArticleTweet`: 标记嵌入推文位置，后续替换为截图
4. 调用 `turndownService.turndown(html)` 生成 Markdown
5. 后处理：
   - 替换 `[EMBED_TWEET]` 为实际截图和引用
   - 替换图片 URL 为图床 CDN URL
   - 清理 X 的 UI 元素（键盘快捷键提示等）

**Markdown 模板：**
```markdown
---
title: "文章标题"
author: "作者名"
source: "原始 X 链接"
date: "提取日期"
---

# 文章标题

> 原文链接: [source](原始链接)
> 作者: @author

![Hero 图](图床URL)

[文章正文内容，图片使用图床 URL，保留所有链接和样式]
```

**verify**: 生成的 Markdown 文件语法正确，图片链接均为图床 URL，无 pbs.twimg.com 域名

### Step 10: 保存并校验 Markdown 文件

**command**:
```bash
# AI 将转换后的 Markdown 写入文件
# 默认文件名: 文章标题（清理特殊字符）.md
# 或使用用户指定的 output 参数
```
**description**: 将最终的 Markdown 保存到指定路径。如果用户未指定输出路径，使用文章标题作为文件名（清理不合法的文件名字符），保存到 `temp/x-article-translate/` 目录。

保存后执行校验：
1. `grep "pbs.twimg.com"` 确认无原始图片 URL 残留
2. `grep "!\["` 确认所有图片都使用图床 URL
3. `grep "\[.*\](http"` 确认链接数量与原文一致
4. 人工检查 Markdown 渲染效果

**verify**: 文件存在且内容完整，所有图片 URL 都是图床地址（非 x.com/pbs.twimg.com 域名），链接和样式正确

### Step 11: 初始化或读取翻译偏好

**command**:
```bash
# 首次执行会交互式提示用户选择供应商、模型并输入 API key
node ${SKILL_DIR}/scripts/x-article/config-translation.mjs \
  [--provider ${PROVIDER}] \
  [--model ${MODEL}]

# 查看当前已保存偏好
node ${SKILL_DIR}/scripts/x-article/config-translation.mjs --show
```
**description**:
翻译配置保存在 `~/.config/x-article-translate/config.json`。首次执行时：
1. 让用户选择翻译供应商：`DeepSeek` 或 `Gemini`
2. 仅展示该供应商最新且适合文本翻译的模型，最多 5 个
3. 引导输入该供应商的 API key
4. 保存到用户偏好文件，后续直接读取

当前内置模型清单：
- DeepSeek: `deepseek-chat`, `deepseek-reasoner`
- Gemini: `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`

如果 workflow 参数中显式传入 `provider` / `model`，优先使用传入值，并回写为新的默认偏好。

**verify**: 配置文件存在，且包含 `default_provider`、`default_model`、对应供应商的 API key

### Step 12: 分析文章主题并生成系统提示词

**command**:
```bash
node ${SKILL_DIR}/scripts/x-article/translate-article.mjs \
  --input "${MARKDOWN_PATH}" \
  --prompt "${TRANSLATION_PROMPT}" \
  --target-language "${TARGET_LANGUAGE:-中文}" \
  --dry-run-prompt
```
**description**:
翻译前先快速分析文章主题，再生成更贴合领域的系统提示词，避免“一把梭”通用翻译。

要求：
1. 默认目标语言是中文
2. 如果 `translation-prompt` 中明确写了“翻译成日文 / 英文 / 其他语言”，则以用户提示词中的目标语言优先
3. 根据文章标题、正文关键词、术语密度判断领域
4. 对 AI / 科技 / 软件工程文章，应生成类似“你是一名资深科技、AI 与软件工程文章翻译专家”的系统角色

例如这篇 `How I Think About Codex`，系统提示词应识别它属于 AI / 技术文章，而不是通用散文。

**verify**: dry-run 输出包含 `analysis`、`system_prompt` 和最终生效的 `target_language`

### Step 13: 调用 AI 翻译 Markdown

**command**:
```bash
node ${SKILL_DIR}/scripts/x-article/translate-article.mjs \
  --input "${MARKDOWN_PATH}" \
  [--output "${TRANSLATED_OUTPUT}"] \
  [--provider "${PROVIDER}"] \
  [--model "${MODEL}"] \
  [--prompt "${TRANSLATION_PROMPT}"] \
  [--target-language "${TARGET_LANGUAGE:-中文}"]
```
**description**:
读取 Step 10 生成的原文 Markdown，调用用户已配置好的供应商进行翻译。

实现要求：
1. DeepSeek 走 `https://api.deepseek.com/chat/completions`
2. Gemini 走 `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
3. 保留 Markdown 结构、frontmatter、图片 URL、链接 URL、代码块
4. 只翻译人类可读文本，不改 YAML 键名与 URL
5. 输出默认保存在原文同目录，例如 `How I Think About Codex.zh.md`

**verify**: 返回 JSON 中包含 `output`、`provider`、`model`、`target_language`，且输出文件存在

### Step 14: 校验译文质量

**command**:
```bash
grep -n "!\[" "${TRANSLATED_OUTPUT}"
grep -n "https://pub-" "${TRANSLATED_OUTPUT}"
grep -n "^source:" "${TRANSLATED_OUTPUT}"
```
**description**:
最低限度校验：
1. 图片仍然存在，没有被模型误删
2. 链接 URL 没有被翻译或破坏
3. frontmatter 键名仍是原样
4. 文章标题、正文、引用已经切换到目标语言

必要时人工 spot check 2-3 个技术段落，确认术语一致性。

**verify**: 译文 Markdown 结构完整，图片和链接保持可用，正文为目标语言

## 注意事项

### X Article DOM 特点（Draft.js 富文本）
- X Article 使用 Draft.js 渲染，**不使用语义化 HTML 标签**（不用 `<em>`、`<strong>`），而是通过内联 CSS 样式控制格式：
  - 斜体: `<span style="font-style: italic;">`
  - 粗体: `<span>` with `font-weight >= 700` 或 CSS class
- 段落容器使用 `div.longform-unstyled` 类名
- 列表使用 `ul.public-DraftStyleDefault-ul` 类名
- 文章内容不在 `<article>` 标签内（`<article>` 是嵌入推文的标签），而在一个无特殊标识的容器 div 中
- **`document.title` 通常为空**，标题需要从页面文本或 heading 元素中提取
- **文章图片不是 `<img>` 标签**：X Article 使用占位 div + `/media/xxx` 链接，必须打开 media 链接才能获取 `pbs.twimg.com/media` 实际图片

### 图片加载机制
- X Article 的图片使用懒加载，**必须滚动到视口才会加载**
- 使用 `img.width` 属性判断尺寸不可靠（CSS 类可能覆盖），应使用 `img.offsetWidth`
- 扫描图片必须在全页滚动完成之后

### 图片质量优化
```javascript
// X 图片 URL 优化 - 获取最大尺寸
function optimizeXImageUrl(url) {
  if (url.includes('pbs.twimg.com')) {
    return url.replace(/name=\w+/, 'name=orig');
  }
  return url;
}
```

### 图片说明文字（Caption）
- 图片嵌在 `<section>` 元素中，同一 section 内的文字是图片说明
- 说明文字通常以 "Source: https://..." 开头
- 必须将说明文字放在 Markdown 图片下方，使用 `>` 引用格式

### PicGo 配置说明
- 默认配置路径:
  - **macOS**: `~/.picgo/config.json`
  - **Windows**: `C:\Users\<用户名>\.picgo\config.json`
  - **Linux**: `~/.picgo/config.json`
- 读取 `picBed.current` 确定当前图床
- 支持的直传图床: `cloudflare-r2`（S3 协议）、`tcyun`（腾讯云 COS）
- 其他图床需启动 PicGo Server（默认端口 36677）
- 可通过 `--picgo-config` 参数指定自定义配置路径

### 错误处理
- 图片下载失败：保留原始 URL 并标注 `<!-- 图片下载失败: ${原因} -->`
- 图床上传失败：保存图片到本地 `./images/` 目录，使用相对路径
- 嵌入内容截图失败：用文字描述替代，附上原始链接
- 翻译 API 请求失败：保留原文 Markdown，记录供应商、模型、HTTP 状态码与错误响应
- 配置文件缺失且当前不是交互式终端：终止并提示先运行 `config-translation.mjs`

### 已知坑位修正
- **不要**对嵌入 `article` 打开 `/media/...` 页面再解析 `img[src*="pbs.twimg.com/media"]`。这会把多个不同嵌入块误判成同一张 hero 图。
- **不要**把 Draft.js 里只包单个链接的 `<div>` 直接丢给 `turndown`。这会把正文中的段内链接强行拆成独立段落，导致换行和原文不一致。
- **不要**在翻译 prompt 里只写“翻译成中文”。应先根据文章主题生成领域角色，再把用户附加要求拼进去。
