# Markdown 转图片方案调研

目标：把 Markdown 可靠地转成固定 3:4 比例图片，再叠加文字或图片水印，适合批量脚本化执行。

## 结论

推荐主路线：`markdown-it -> HTML/CSS -> Playwright 截图 -> sharp 水印`

原因：

- `markdown-it` 已经在本仓库内使用，依赖和用法一致，适合把 Markdown 先变成可控的 HTML。
- `Playwright` 官方直接支持 `page.setContent()` 和 `page.screenshot()`，适合固定画布尺寸、等字体加载完成后再截图。
- `sharp` 官方提供 `composite()`，可以把文字水印或图片水印叠加到导出图上，且便于后续压缩、转格式和批量处理。

## 方案对比

### 方案 A：`markdown-it + Playwright + sharp`，推荐

适合：服务端批量生成、定尺寸导出、后处理要求多。

优点：

- Markdown 解析、版式渲染、导出截图、水印处理职责清晰
- 可精确控制 3:4 画布，例如 `1200x1600`
- 能等待字体、图片、异步内容稳定后再截图
- 水印、裁切、压缩、导出 png/jpg 都能继续交给 `sharp`

缺点：

- 需要安装浏览器运行时
- 需要自己维护一套 HTML/CSS 主题

### 方案 B：`node-html-to-image`

仓库：<https://github.com/frinyvonnick/node-html-to-image>

特点：封装了 HTML 到图片，底层使用 Puppeteer。

适合：想少写一些 Playwright/Puppeteer 启动代码。

不选它做主路线的原因：

- 它本质上仍然是 HTML 截图路线
- 封装层更高，复杂排版和调试时不如直接控制 Playwright 灵活
- GitHub API 显示该仓库在 2026-02-26 更新，但 `pushed_at` 是 2024-09-03，稳定可用但不如 Playwright 主线活跃

### 方案 C：`html-to-image`

仓库：<https://github.com/bubkoo/html-to-image>

特点：把浏览器中的 DOM 节点导出成图片。

适合：已经有前端页面和浏览器 DOM，想在前端直接导图。

不选它做主路线的原因：

- 更偏浏览器端导出，而不是 Node 脚本批处理
- Markdown 到图片仍然要先有 DOM 页面环境
- 当前仓库主要是 Node 脚本和自动化，不是现成的前端应用

### 方案 D：一体化 `markdown-to-image`

仓库：<https://github.com/gcui-art/markdown-to-image>

特点：定位就是 Markdown 转图片。

适合：快速试用现成方案。

不选它做主路线的原因：

- 作为独立工具很方便，但仓库内已经有 `markdown-it`，继续复用更一致
- 若后续要叠加自定义水印、分页、主题、批量导出，自己掌握 HTML/CSS + 截图层更容易扩展

## GitHub 活跃度快照

数据来自 2026-03-31 运行的 GitHub API 查询：

- `microsoft/playwright`: 85,293 stars, `pushed_at` 2026-03-31T01:00:44Z
- `lovell/sharp`: 32,083 stars, `pushed_at` 2026-03-24T21:15:38Z
- `markdown-it/markdown-it`: 21,229 stars, `pushed_at` 2026-03-26T17:26:45Z
- `bubkoo/html-to-image`: 7,085 stars, `pushed_at` 2026-03-14T03:19:39Z
- `gcui-art/markdown-to-image`: 1,871 stars, `pushed_at` 2025-03-05T02:49:48Z
- `frinyvonnick/node-html-to-image`: 876 stars, `pushed_at` 2024-09-03T09:50:03Z

## 推荐 workflow

### Step 1：Markdown 转 HTML

- 使用 `markdown-it` 渲染 Markdown
- 保留代码块、列表、引用、链接、表格等基础结构
- 可选：移除 frontmatter，提取首个 `#` 作为海报标题

### Step 2：HTML 套 3:4 画布主题

- 固定画布尺寸，例如 `1200x1600`
- 用 CSS 控制标题区、正文区、间距、背景和最大可视高度
- 正文过长时做自动缩放，避免内容超出画布

### Step 3：Playwright 截图

- `page.setContent(html)`
- 等 `document.fonts.ready`
- 对目标容器截图，而不是整页截图

### Step 4：sharp 叠加水印

- 图片水印：右下角缩放后叠加
- 文字水印：右下角半透明斜放
- 两者可以组合成一个透明 overlay 后一次 `composite()`

### Step 5：输出与验证

- 默认输出 png
- 若用户需要社媒上传图，可加 jpg 导出
- 验证点：尺寸必须严格为 `3:4`，右下角出现预期水印，长文不会溢出画布

## 本仓库落地建议

- 解析层继续复用现有 `markdown-it`
- 新增 `scripts/markdown-image/render-markdown-card.mjs`
- 默认主题放在 `references/markdown-card-theme.css`
- workflow 定义放在 `workflows/markdown-to-image-watermark.md`

## 来源

- Playwright `Page` API：<https://playwright.dev/docs/api/class-page>
- sharp `composite()`：<https://sharp.pixelplumbing.com/api-composite/>
- markdown-it：<https://github.com/markdown-it/markdown-it>
- node-html-to-image：<https://github.com/frinyvonnick/node-html-to-image>
- html-to-image：<https://github.com/bubkoo/html-to-image>
- markdown-to-image：<https://github.com/gcui-art/markdown-to-image>
