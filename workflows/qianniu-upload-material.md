---
name: 千牛上传素材
description: 打开千牛后台素材中心，进入我的图片/视频，打开上传弹窗
domain: myseller.taobao.com
created: 2026-03-27
updated: 2026-03-27
---

# 千牛上传素材

## 前置条件

- 已在 Chrome 中登录千牛后台（淘宝卖家账号）

## Steps

### Step 1: 打开千牛后台并检测登录状态

**command**: `agent-browser open "https://myseller.taobao.com/home.htm/QnworkbenchHome/"`
**description**: 打开千牛商家工作台首页。如果未登录，页面会重定向到包含 `login` 的 URL。检测到重定向时终止 workflow，提示用户先登录。
**verify**: URL 包含 `myseller.taobao.com`，不包含 `login`

### Step 2: 点击侧边栏"商品"

**command**: `agent-browser eval 'const t=[...document.querySelectorAll("a")].find(a=>a.textContent.trim()==="商品");if(t){t.click();"ok"}else{"not found"}'`
**description**: 在左侧导航栏找到"商品"菜单项并点击，展开商品相关的子导航。侧边栏不在可访问性树中，需要通过 eval 查询 DOM 操作。
**verify**: URL 包含 `/SellManage` 或页面出现"素材中心"子菜单

### Step 3: 点击"素材中心"

**command**: `agent-browser eval 'const t=[...document.querySelectorAll("a,span,div")].find(e=>e.textContent.trim()==="素材中心");if(t){t.click();"ok"}else{"not found"}'`
**description**: 在商品子导航中找到"素材中心"并点击，进入素材管理页面。
**verify**: URL 包含 `/material-center`

### Step 4: 点击"我的图片/视频" tab

**command**: `agent-browser click "tab:has-text('我的图片/视频')"`
**description**: 在素材中心顶部 tab 栏中点击"我的图片/视频"，切换到个人素材管理视图。此 tab 在可访问性树中，可通过 snapshot 获取 @ref 后点击。
**verify**: URL 包含 `/mine-material`

### Step 5: 点击"上传文件"按钮

**command**: `agent-browser click "button:has-text('上传文件')"`
**description**: 点击页面中的"上传文件"按钮，弹出上传素材的对话框。
**verify**: 页面出现上传弹窗（包含"上传素材"标题或文件拖拽区域）
