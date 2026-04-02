---
name: article-export-markdown
description: 将公开网页文章导出为本地 Markdown，并把正文图片上传到 PicGo 配置的图床
domain: generic-web
params:
  - name: url
    required: true
    description: 文章 URL，如 https://example.com/posts/hello-world
  - name: output
    required: false
    description: 输出 Markdown 文件路径，默认保存到 temp/article-export-markdown/
  - name: picgo-config
    required: false
    description: PicGo 配置文件路径，默认自动查找本机 PicGo 配置
created: 2026-04-02
updated: 2026-04-02
---

# 网页文章导出为 Markdown

将公开可访问的网页文章抓取为本地 Markdown。正文内图片会先下载到本地，再像 `x-article-translate` 一样上传到 PicGo 配置的图床，最终 Markdown 中引用图床 URL。

## 前置条件

- `bash scripts/check-deps.sh` 可以通过
- 目标文章无需登录，或当前环境能直接访问
- 本机已配置 PicGo；若上传失败，脚本会保留本地图片相对路径作为兜底

## 核心脚本

- `scripts/article-export/export-article-markdown.mjs` - 读取网页 HTML、抽取正文、下载并上传图片、输出最终 Markdown
- `scripts/x-article/download-image.mjs` - 下载远程图片到本地
- `scripts/x-article/picgo-upload.mjs` - 读取 PicGo 配置并上传图片到图床

## 推荐入口

```bash
node scripts/article-export/export-article-markdown.mjs "${URL}" \
  [--output "temp/article-export-markdown/article.md"] \
  [--picgo-config "${PICGO_CONFIG}"]
```

## Steps

### Step 1: 环境检查

**command**: `bash scripts/check-deps.sh`
**description**: 检查 Node.js、Chrome 调试端点和 CDP Proxy 是否可用。虽然这个导出脚本默认直接抓取公开 HTML，但 workflow 仍沿用仓库统一的环境检查入口。
**verify**: 输出包含 `node: ok`、`chrome: ok`、`proxy: ready`

### Step 2: 抓取页面 HTML 并识别正文容器

**command**: `node scripts/article-export/export-article-markdown.mjs "${URL}"`
**description**: 脚本使用浏览器 UA 直接请求文章页面，优先识别 `<article>`，否则在 `main`、`.post-content`、`.entry-content` 等候选容器中选择正文分数最高的一块。会提取标题、作者、发布日期和描述，并清理目录、分享区、隐私提示等非正文节点。
**verify**: `logs/export-result.json` 中存在 `metadata.title`，且输出的 Markdown 不为空

### Step 3: 下载正文图片并上传图床

**command**: `node scripts/article-export/export-article-markdown.mjs "${URL}" [--picgo-config "${PICGO_CONFIG}"]`
**description**: 对正文中的每张图片解析绝对地址，调用 `scripts/x-article/download-image.mjs` 下载到 `temp/article-export-markdown/downloads/`，随后调用 `scripts/x-article/picgo-upload.mjs` 上传到图床。若某张图上传失败，则 Markdown 退回引用本地相对路径，不中断整篇导出。
**verify**: `logs/export-result.json` 中 `imageCount` 与正文图片数量一致，且每张图片都记录了 `outputUrl`

### Step 4: HTML 转 Markdown 并写入输出目录

**command**: `node scripts/article-export/export-article-markdown.mjs "${URL}" [--output "${OUTPUT}"]`
**description**: 将清理后的正文 HTML 交给 Turndown 转为 Markdown，保留标题层级、链接、代码块、表格和图片；`<figure>` 会转成 Markdown 图片并附上 figcaption。默认输出到 `temp/article-export-markdown/`，并同时写日志到 `temp/article-export-markdown/logs/`。
**verify**: 输出目录下生成 `.md` 文件，文件头包含 `title/source/date/downloaded_at` frontmatter
