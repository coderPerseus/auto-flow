---
name: 千牛上传素材
description: 打开千牛后台素材中心，上传本地文件到我的图片/视频
domain: myseller.taobao.com
params:
  - name: files
    description: 要上传的本地文件路径，支持单个路径或多个路径数组
    required: true
    example: ["/path/to/image1.png", "/path/to/image2.jpg"]
created: 2026-03-27
updated: 2026-03-27
---

# 千牛上传素材

## 前置条件

- 已在 Chrome 中登录千牛后台（淘宝卖家账号）
- 准备好要上传的本地文件路径

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

**command**: `agent-browser eval '(() => { const tabs = document.querySelectorAll("[role=tab]"); for (const t of tabs) { if (t.textContent.includes("我的图片/视频")) { t.click(); return "clicked"; } } return "not found"; })()'`
**description**: 在素材中心顶部 tab 栏中点击"我的图片/视频"，切换到个人素材管理视图。该 tab 在可访问性树中可见，但通过 @ref 点击可能不生效（SPA 路由未切换），用 eval 直接查找 role=tab 元素点击更可靠。
**verify**: URL 包含 `/mine-material`

### Step 5: 点击"上传文件"按钮

**command**: `agent-browser click "button:has-text('上传文件')"`
**description**: 点击页面中的"上传文件"按钮，弹出上传素材的对话框。
**verify**: 页面出现上传弹窗（包含"上传素材"标题或文件拖拽区域）

### Step 6: 上传本地文件

**command**: `CDP /setFiles — selector="#sucai-tu-upload-pannel input[type=file]"，files 从 workflow 参数获取`
**description**: 上传弹窗中有一个 id="sucai-tu-upload" 的上传区域（文案"点击/拖拽，批量导入文件"）。不要点击该按钮（会弹出系统文件对话框，无法自动化）。该区域的 file input 实际位于 `#sucai-tu-upload-pannel` 容器内（注意不是 `#sucai-tu-upload`），input 的 id 是动态生成的，用父容器选择器 `#sucai-tu-upload-pannel input[type=file]` 定位。通过 CDP Proxy 的 `/setFiles` 接口直接设置文件路径，绕过对话框。accept 类型为 jpeg/bmp/gif/heic/png/webp，支持 multiple。文件路径从 workflow 参数 `files` 获取。示例：`curl -s -X POST "http://localhost:3456/setFiles?target=ID" -d '{"selector":"#sucai-tu-upload-pannel input[type=file]","files":["路径"]}'`
**verify**: 页面出现"上传结果"弹窗，显示文件名和上传完成状态
