---
name: markdown-image-card
description: 将 Markdown 渲染为 3:4 比例图片，并叠加文字或图片水印
domain: local
params:
  - name: input
    required: true
    description: Markdown 文件路径
  - name: output
    required: false
    description: 导出的图片路径，默认建议保存到 temp/markdown-image-card/output.png
  - name: title
    required: false
    description: 自定义海报标题，默认使用 Markdown 首个一级标题或文件名
  - name: watermark-text
    required: false
    description: 文字水印，例如品牌名、账号名或来源
  - name: watermark-image
    required: false
    description: 图片水印路径，例如 logo png 或 svg
created: 2026-03-31
updated: 2026-03-31
---

# Markdown 转 3:4 图片并加水印

将本地 Markdown 渲染成固定 3:4 画布的图片海报，默认导出为 PNG，并在导出图右下角叠加文字水印、图片水印或两者组合。选型说明见 `references/markdown-image-workflow.md`。

## 前置条件

- Node.js 可用
- 已执行 `npm install`
- 若首次运行 Playwright 且本机未安装 Chromium，执行 `npx playwright install chromium`
- 输入 Markdown 不应长到接近整篇长文海报，超长内容应拆页或摘要化

## 推荐入口

```bash
node scripts/markdown-image/render-markdown-card.mjs \
  --input "${INPUT}" \
  --output "${OUTPUT:-temp/markdown-image-card/output.png}" \
  --watermark-text "${WATERMARK_TEXT:-}" \
  --watermark-image "${WATERMARK_IMAGE:-}"
```

## Steps

### Step 1: Markdown 转 HTML

**command**: `node scripts/markdown-image/render-markdown-card.mjs --input "${INPUT}" --output "${OUTPUT}" --html-output "temp/markdown-image-card/preview.html"`
**description**: 读取本地 Markdown，默认移除 frontmatter，用 `markdown-it` 渲染为 HTML，并套用固定 3:4 主题布局。标题优先使用 `--title`，否则使用 Markdown 首个一级标题或文件名。
**verify**: `preview.html` 存在，且 HTML 中包含 `id="card"` 的固定画布容器

### Step 2: 用 Playwright 渲染固定比例海报

**command**: `node scripts/markdown-image/render-markdown-card.mjs --input "${INPUT}" --output "${OUTPUT}"`
**description**: 用 Playwright 在固定 viewport 中加载 HTML，等待字体完成，再对海报容器截图。正文过长时自动缩放，优先保证内容不溢出画布。
**verify**: 输出图片存在，尺寸为 `1200x1600` 或用户显式指定的 `width x height`

### Step 3: 叠加水印

**command**: `node scripts/markdown-image/render-markdown-card.mjs --input "${INPUT}" --output "${OUTPUT}" --watermark-text "${WATERMARK_TEXT}" --watermark-image "${WATERMARK_IMAGE}"`
**description**: 若给定文字水印或图片水印，则使用 `sharp` 在导出图右下角叠加透明 overlay。文字水印适合品牌名、作者名、渠道名；图片水印适合 logo。
**verify**: 输出图片右下角出现预期水印，且主体内容未被明显遮挡

### Step 4: 输出结果供后续发布

**description**: 将最终图片保存在 `temp/markdown-image-card/` 或用户指定目录。后续可直接用于公众号封面、社媒配图、图床上传或二次压缩。
**verify**: 目标目录下存在最终图片文件，用户可直接打开查看
