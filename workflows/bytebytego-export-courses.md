---
name: bytebytego-export-courses
description: 将 ByteByteGo 我的课程页中已开放的课程导出为本地 Markdown，每门课一个文件
domain: bytebytego.com
params:
  - name: output-dir
    required: false
    description: 导出目录，默认 temp/bytebytego-course-export
  - name: course
    required: false
    description: 仅导出课程标题包含该关键字的课程
  - name: limit
    required: false
    description: 最多导出多少门课程，默认导出全部可访问课程
created: 2026-04-02
updated: 2026-04-02
---

# ByteByteGo 课程导出为 Markdown

把 `https://bytebytego.com/my-courses` 中当前账号可访问的课程自动导出到本地 Markdown。默认跳过带 `Coming Soon` 遮罩的课程，每门课程合并为一个 Markdown 文件，保存在 `temp/bytebytego-course-export/`。

## 前置条件

- Chrome 已开启远程调试
- 当前 Chrome 已登录 ByteByteGo
- `bash scripts/check-deps.sh` 可以通过

## 核心脚本

- `scripts/bytebytego/export-courses-markdown.mjs` - 程序化入口，负责打开课程页、识别课程卡片、抓取 lesson 列表、逐页转换为 Markdown

## 推荐入口

```bash
node scripts/bytebytego/export-courses-markdown.mjs \
  [--output-dir "temp/bytebytego-course-export"] \
  [--course "System Design"] \
  [--limit 2]
```

## Steps

### Step 1: 环境检查

**command**: `bash scripts/check-deps.sh`
**description**: 检查 Node.js、Chrome 调试端点和 CDP Proxy 是否可用，确保后续浏览器自动化可执行。
**verify**: 输出包含 `node: ok`、`chrome: ok`、`proxy: ready`

### Step 2: 打开 My Courses 页面并识别可访问课程

**command**: `curl -s "http://127.0.0.1:3456/new?url=https://bytebytego.com/my-courses"`
**description**: 在独立 tab 中打开课程页，读取 `li.style_courseItem__MV4Ic` 课程卡片。课程标题取卡片封面图 `alt` 文本；若卡片文字包含 `Coming Soon`，默认排除。
**verify**: 能识别到课程卡片列表，并至少存在 1 门非 `Coming Soon` 课程

### Step 3: 进入每门课程并提取侧边 lesson 路径

**command**: `node scripts/bytebytego/export-courses-markdown.mjs --limit 1`
**description**: 脚本会返回 My Courses 页面，按卡片顺序点击课程进入阅读器；然后从侧边菜单的 `li[data-menu-id]` 中提取每个 lesson 的真实路径 `/courses/...`。不依赖页面公开 href，因为课程卡片本身是点击跳转而不是直接锚点。
**verify**: 每门课程都能提取出非空的 lesson 路径列表

### Step 4: 将每个 lesson 的 article HTML 转为 Markdown

**command**: `node scripts/bytebytego/export-courses-markdown.mjs`
**description**: 对每个 lesson URL 逐页导航，抓取 `article` 内容，清理无关节点，将相对链接和图片地址转为绝对 URL，再用 Turndown 转换为 Markdown。最终按“一门课一个 Markdown”合并输出。
**verify**: 输出目录下生成课程 Markdown 文件，且每个文件都包含课程标题、目录和 lesson 正文

### Step 5: 写入日志和导出结果

**command**: `node scripts/bytebytego/export-courses-markdown.mjs --output-dir "temp/bytebytego-course-export"`
**description**: 导出完成后把课程卡片识别结果、每门课的 lesson 清单和最终导出摘要写到 `temp/bytebytego-course-export/logs/`，便于后续复查或增量更新。
**verify**: `logs/export-result.json` 存在，且其中的课程数量与输出文件数量一致
