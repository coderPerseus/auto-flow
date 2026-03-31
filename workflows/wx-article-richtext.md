---
name: wx-article-publish
description: 将 Markdown 转为微信公众号富文本，并自动发布到公众号草稿箱
domain: wechat
params:
  - name: input
    required: true
    description: Markdown 或已生成的微信公众号富文本文件路径
  - name: richtext-output
    required: false
    description: 富文本 HTML 输出路径，默认保存到 temp/wx-article/
  - name: title
    required: false
    description: 文章标题，默认使用富文本文件名（不含扩展名）
created: 2026-03-31
updated: 2026-03-31
---

# Markdown 自动发布到微信公众号

将本地 Markdown 转为微信公众号编辑器可直接粘贴的 HTML 片段，然后在已登录的微信公众号后台中自动创建新文章、填充标题与正文。默认主题样式位于 `references/wx-article-theme.css`。

## 前置条件

- Node.js 可用
- Chrome 已打开并保持用户自己的微信公众号登录态
- 若打开 `https://mp.weixin.qq.com/` 后没有自动跳转到后台路由，而是停留在登录页，必须立即停止并提示用户先登录

## 推荐入口

```bash
node scripts/wx-article/markdown-to-wechat-richtext.mjs \
  --input "${INPUT}" \
  --output "${RICHTEXT_OUTPUT:-temp/wx-article/output.md}"
```

## Steps

### Step 1: 生成微信公众号富文本

**command**: `node scripts/wx-article/markdown-to-wechat-richtext.mjs --input "${INPUT}" --output "${RICHTEXT_OUTPUT}"`
**description**: 读取 Markdown，默认移除 frontmatter，按 mdnice 结构补齐标题 `.prefix/.content/.suffix`、列表 `li section`、引用 `.multiquote-*` 等，并将 `references/wx-article-theme.css` 内联到生成的 HTML。
**verify**: 输出文件存在，且内容以 `<section id="nice">` 开头

### Step 2: 检查微信公众号登录态

**description**: 打开 `https://mp.weixin.qq.com/`。如果页面自动跳转到类似 `https://mp.weixin.qq.com/cgi-bin/home?...` 的后台路由，继续执行；如果仍停留在登录页，则立即停止并提示用户先登录微信公众号平台。
**verify**: 当前页面 URL 为 `mp.weixin.qq.com/cgi-bin/` 下的后台路由，而不是登录首页

### Step 3: 进入草稿箱并创建新文章

**description**: 点击 `#menu_10125` 进入草稿箱，再点击“写新文章”进入文章编辑页。
**verify**: 当前页面进入 `/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77`

### Step 4: 填充标题和正文

**description**: 标题默认使用富文本文件名（不含扩展名），例如 `codex-1.md` 对应标题 `codex-1`。正文读取富文本文件内容，并写入文章编辑器的 ProseMirror 内容区。
**verify**: 编辑器中可见正文内容，标题输入框已填入预期标题

### Step 5: 停留在编辑页等待人工确认

**description**: 自动填充完成后，不主动群发、不主动提交审核，停留在编辑页面供用户检查。
**verify**: 页面仍处于文章编辑页，正文与标题均已填充
