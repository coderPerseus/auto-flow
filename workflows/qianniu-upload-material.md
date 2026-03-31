---
name: 千牛上传素材
description: 上传本地图片到千牛素材中心和商品发布页，完成 AI 智能发品并自动填充编辑表单
domain: myseller.taobao.com
params:
  - name: files
    description: 要上传的本地文件路径，支持单个路径或多个路径数组
    required: true
    example: ["/path/to/image1.png", "/path/to/image2.jpg"]
  - name: product_form_file
    description: 商品表单参数 JSON 文件路径，定义标题、卖点、价格、库存、详情描述和属性字段
    required: true
    example: "/Users/zozy/code/personal/auto-flow/references/qianniu-product-form.example.json"
created: 2026-03-27
updated: 2026-03-31
---

# 千牛上传素材

## 前置条件

- 已在 Chrome 中登录千牛后台（淘宝卖家账号）
- 准备好要上传的本地文件路径
- 准备好商品表单参数 JSON（可参考 `references/qianniu-product-form.example.json`）

## 性能优化说明

- **全程使用 CDP Proxy**，不使用 agent-browser（避免 snapshot 开销和超时风险）
- **直达 URL**，跳过菜单逐级导航
- **并行打开 tab**，素材中心和发布页同时加载
- **并行上传**，两个 tab 同时上传文件，等待最长分支完成
- **合并 eval**，多步 DOM 操作合并为单次原子调用
- **内联 verify**，command 末尾自带验证，减少 tool call 轮次
- **无固定 sleep**，依赖 CDP `/new` 内置的 readyState 等待

## Steps

### Step 1: 并行打开素材中心和发布页

**command**:
```bash
eval $(bash ${CLAUDE_SKILL_DIR}/scripts/open-tabs.sh \
  "MATERIAL_ID|https://myseller.taobao.com/home.htm/material-center/mine-material/sucai-tu" \
  "PUBLISH_ID|https://upload.taobao.com/auction/sell.jhtml")
```
**description**: 使用 `open-tabs.sh` 脚本并行打开素材中心和发布页。脚本自动验证每个 targetId 对应的 URL（通过域名关键词+路径段匹配），输出 `MATERIAL_ID=xxx` 和 `PUBLISH_ID=xxx` 变量，消除 shell 并发返回顺序不确定导致的 ID 互换风险。
**verify**: 两个 tab 均已打开。素材中心 URL 包含 `/mine-material`；发布页标题为"商品发布"，URL 包含 `item.upload.taobao.com`。如果素材中心 URL 包含 `login`，终止 workflow 提示用户登录。

### Step 2: 并行上传文件到两个 tab

**command**:
```bash
# 分支 A：素材中心上传 → 关弹窗 → 关 tab
(
  # 点击"上传文件"
  curl -s -X POST "http://localhost:3456/eval?target=MATERIAL_ID" \
    -d '(function(){ var btns=[].slice.call(document.querySelectorAll("button,a,span,div")); for(var i=0;i<btns.length;i++){if(btns[i].textContent.trim().indexOf("上传文件")>=0){btns[i].click(); return "clicked"}} return "not found" })()'

  sleep 2

  # setFiles 上传
  printf '{"selector":"#sucai-tu-upload-pannel input[type=file]","files":["文件路径"]}' \
    | curl -s -X POST "http://localhost:3456/setFiles?target=MATERIAL_ID" -d @-

  sleep 3

  # 关闭"上传结果"弹窗
  curl -s -X POST "http://localhost:3456/eval?target=MATERIAL_ID" \
    -d '(function(){ var btn=[].slice.call(document.querySelectorAll("button,span")).find(function(b){return b.textContent.trim()==="完成"}); if(btn){btn.click(); return "ok"} return "not found" })()'

  # 关闭素材中心 tab
  curl -s "http://localhost:3456/close?target=MATERIAL_ID"
) &

# 分支 B：发布页上传 → 等 AI 识别
(
  # 点击"从本地上传"
  curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
    -d '(function(){ var btns=[].slice.call(document.querySelectorAll("button")); for(var i=0;i<btns.length;i++){var t=btns[i].textContent.trim(); if(t.indexOf("从本地上传")>=0){btns[i].click(); return "clicked"}} return "not found" })()'

  sleep 1

  # setFiles 上传
  printf '{"selector":"input[type=file]","files":["文件路径"]}' \
    | curl -s -X POST "http://localhost:3456/setFiles?target=PUBLISH_ID" -d @-

  # 等待 AI 识别完成
  sleep 5
) &

wait
echo "--- parallel upload done ---"

# 验证发布页状态
curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
  -d '(function(){ return JSON.stringify({uploadSuccess: document.body.innerText.indexOf("上传成功")>=0, confirmBtn: document.body.innerText.indexOf("确认")>=0 && document.body.innerText.indexOf("下一步")>=0}); })()'
```
**description**: 两个 tab 并行上传文件。分支 A（素材中心）：点击"上传文件"→ sleep 2s 等弹窗渲染（1s 不够，file input 可能未出现）→ setFiles → 等上传完成 → 关弹窗 → 关 tab。分支 B（发布页）：点击"从本地上传"→ sleep 1s → setFiles → sleep 5s 等 AI 识别。文件路径从参数 `files` 获取。**注意**：文件路径可能含特殊字符，必须用 `printf` 管道传递 JSON。按钮匹配用 `indexOf` 而非 `===`，因为按钮文本可能有额外空白或嵌套元素。
**verify**: 发布页出现绿色"上传成功"提示文字，"确认，下一步"按钮可见。素材中心 tab 已关闭。

### Step 3: 发布页点击第一次"确认，下一步"

**command**:
```bash
# 点击 → 等页面切换 → 验证
curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
  -d '(function(){ var btns = document.querySelectorAll("button"); for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.trim().indexOf("确认") >= 0 && btns[i].textContent.trim().indexOf("下一步") >= 0) { btns[i].scrollIntoView({block:"center"}); btns[i].click(); return "clicked"; } } return "not found"; })()'

sleep 3

curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
  -d '(function(){ return JSON.stringify({hasBrand: document.body.innerText.indexOf("品牌")>=0, hasConfirm: document.body.innerText.indexOf("确认")>=0, url: window.location.href}); })()'
```
**description**: 图片上传且 AI 处理完成后，点击"确认，下一步"进入图片属性页。此页面包含品牌选择器、1:1/3:4主图上传位、详情描述等。URL 仍为 `category.htm`，内容通过 AJAX 更新。
**verify**: 页面切换到图片属性页，可见"品牌"字段、1:1主图和3:4主图上传区域、"确认，下一步"按钮。

### Step 4: 选择品牌

**command**:
```bash
# 4a: 点击品牌下拉框
curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
  -d '(function(){ var inputs = document.querySelectorAll("input"); if(inputs.length<2) return "brand input not found"; inputs[1].click(); return "brand dropdown opened"; })()'

sleep 1

# 4b: 搜索"无品牌" + 选择（合并为一次 eval，内置 200ms 延迟等过滤结果）
curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
  -d '(function(){
    var inputs = document.querySelectorAll("input");
    var searchInput = inputs[2];
    if (!searchInput) return "search input not found";
    searchInput.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(searchInput, "\u65E0\u54C1\u724C");
    searchInput.dispatchEvent(new Event("input", {bubbles: true}));
    return "searched";
  })()'

sleep 1

curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
  -d '(function(){
    var items = document.querySelectorAll(".options-item, li");
    for (var i = 0; i < items.length; i++) {
      if (items[i].textContent.trim().indexOf("\u65E0\u54C1\u724C") >= 0) {
        items[i].click();
        return "brand selected";
      }
    }
    return "brand option not found";
  })()'
```
**description**: 在图片属性页选择品牌。品牌是必填字段（标红星 *），不填则"确认，下一步"静默失败。品牌下拉框结构：主输入框（input[1]，placeholder 可能为"请选择"或"请输入"）→ 下拉搜索框（input[2]）→ 选项列表（.options-item 或 li）。搜索框必须用 React 兼容的 nativeInputValueSetter + input 事件触发过滤。默认选择"无品牌"。注意：3 步操作之间需要 sleep 等待 DOM 异步更新，无法合并为单次 eval。
**verify**: 品牌输入框显示"无品牌"文本

### Step 5: 点击第二次"确认，下一步"进入编辑表单

**command**:
```bash
curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
  -d '(function(){ var btns = document.querySelectorAll("button"); for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.trim().indexOf("确认") >= 0 && btns[i].textContent.trim().indexOf("下一步") >= 0) { btns[i].scrollIntoView({block:"center"}); btns[i].click(); return "clicked"; } } return "not found"; })()'

sleep 3

curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
  -d '(function(){ return JSON.stringify({url: window.location.href, hasForm: document.body.innerText.indexOf("基础信息")>=0 || document.body.innerText.indexOf("销售信息")>=0}); })()'
```
**description**: 品牌已选、图片已上传，点击"确认，下一步"跳转到完整编辑表单。
**verify**: URL 变为 `item.upload.taobao.com/sell/v2/publish.htm`，页面包含基础信息、销售信息、物流服务等表单区块

### Step 6: 自动填充商品详情页表单

**command**:
```bash
node ${CLAUDE_SKILL_DIR}/scripts/qianniu/fill-publish-form.mjs \
  --target "${PUBLISH_ID}" \
  --product "商品表单 JSON 路径"
```
**description**: 在发布编辑页读取本地 JSON 参数文件，按字段标签自动匹配并填充常见表单项。脚本优先处理商品标题、卖点、价格、划线价、库存、重量、商家编码、品牌、运费模板和详情描述；同时支持 `attributes`、`selects`、`radios`、`fields` 四类扩展字段，用于补充类目属性、单选项和自定义标签字段。匹配方式以页面可见标签文本为主，兼容普通 `input/textarea`、下拉选择、单选选项以及 `contenteditable` 富文本区域。脚本会输出 `filled/skipped` 报告；若一个字段都没填上则直接失败，若部分字段未匹配则保留 `partial` 状态供 AI 兜底继续完成。
**verify**: 脚本输出 JSON 结果中 `status` 为 `ok` 或 `partial`，且 `filled` 至少包含商品标题或价格等核心字段；页面仍停留在 `publish.htm`，基础信息/销售信息区块中能看到已写入的值

## 商品表单参数示例

参考文件：`references/qianniu-product-form.example.json`

```json
{
  "title": "韩系慵懒风豹纹数字印花宽松长袖T恤女白色圆领上衣",
  "subtitle": "宽松落肩版型，春秋可单穿或叠搭",
  "description": "1. 白色底色搭配豹纹数字印花，视觉简洁不单调。\n2. 宽松版型和落肩袖设计，上身更有松弛感。\n3. 面料轻薄柔软，适合春秋日常通勤、校园和休闲穿搭。",
  "price": "79",
  "originalPrice": "99",
  "stock": "200",
  "brand": "无品牌",
  "itemCode": "WYI-70-WHT",
  "weight": "0.35",
  "attributes": {
    "袖长": "长袖",
    "领型": "圆领"
  },
  "radios": {
    "是否开票": "否"
  },
  "fields": {
    "材质成分": {
      "mode": "text",
      "value": "棉"
    }
  }
}
```
