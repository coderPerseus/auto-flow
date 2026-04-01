---
name: 千牛上传素材
description: 上传本地图片到千牛素材中心和商品发布页，完成 AI 智能发品、自动填充编辑表单并保存为草稿
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
updated: 2026-04-01
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
- **草稿收尾**，默认保存草稿，等待人工审核，不直接发布

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

  # 动态定位最新弹出的 file input，避免页面改版后固定 selector 失效
  curl -s -X POST "http://localhost:3456/eval?target=MATERIAL_ID" \
    -d '(function(){ var inputs=[].slice.call(document.querySelectorAll("input[type=file]")); inputs.forEach(function(el){el.removeAttribute("data-autoflow-upload")}); var target=inputs.reverse().find(function(el){ var style=window.getComputedStyle(el); return style.display!=="none" && style.visibility!=="hidden"; }) || document.querySelector("input[type=file]"); if(!target) return "file input not found"; target.setAttribute("data-autoflow-upload","1"); return "tagged"; })()'

  # setFiles 上传
  printf '{"selector":"input[type=file][data-autoflow-upload=\"1\"]","files":["文件路径"]}' \
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
  # 若还在发品方式入口页，先进入"以图发品"
  curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
    -d '(function(){ if(document.body.innerText.indexOf("从本地上传")>=0) return "already image mode"; var btns=[].slice.call(document.querySelectorAll("button")); for(var i=0;i<btns.length;i++){ var scope=btns[i].closest("div,section,li") || btns[i].parentElement; var txt=(scope&&scope.textContent)||btns[i].textContent||""; if(txt.indexOf("以图发品")>=0 && btns[i].textContent.trim().indexOf("开启")>=0){ btns[i].click(); return "entered image mode"; } } return "image mode entry not found"; })()'

  sleep 2

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
**description**: 两个 tab 并行上传文件。分支 A（素材中心）：点击"上传文件"→ sleep 2s 等弹窗渲染→ 动态给最新出现的 `input[type=file]` 打标 → `setFiles` 上传 → 等上传完成 → 关弹窗 → 关 tab，避免固定 selector 因页面改版失效。分支 B（发布页）：如果还停在发品方式入口页，先点击"以图发品"卡片里的"开启"；进入图片上传页后点击"从本地上传"→ sleep 1s → `setFiles` → sleep 5s 等 AI 识别。文件路径从参数 `files` 获取。**注意**：文件路径可能含特殊字符，必须用 `printf` 管道传递 JSON。按钮匹配用 `indexOf` 而非 `===`，因为按钮文本可能有额外空白或嵌套元素。
**verify**: 发布页出现绿色"上传成功"提示文字，"确认，下一步"按钮可见。素材中心 tab 已关闭。若素材中心分支返回 `file input not found`，但发布页上传成功，则继续主流程，不因素材中心单独失败而中止发品。

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
**description**: 图片上传且 AI 处理完成后，点击"确认，下一步"进入类目确认页。2026-04-01 实测该页仍停留在 `category.htm`，但主要内容变为"商品类目"、`1:1主图`、`3:4主图`、`详情描述` 和第二个"确认，下一步"按钮；不再稳定出现独立品牌选择页。
**verify**: 页面仍为 `category.htm`，且可见"商品类目"、`1:1主图`、`3:4主图`、`详情描述`、"确认，下一步"按钮。

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
**description**: 该步骤保留为兼容旧版中间页的兜底。2026-04-01 实测多数情况下第一步后不会进入独立品牌页，而是直接停留在类目确认页，因此此处可能返回 `brand input not found` / `search input not found` / `brand option not found`。若出现这些结果，但页面仍是包含"商品类目"、`1:1主图`、`3:4主图`、"确认，下一步"的 `category.htm`，应将本步骤视为 **SKIP**，直接进入下一步；只有当页面确实出现独立品牌选择器时，才执行"无品牌"选择流程。
**verify**: 品牌输入框显示"无品牌"文本；或返回 SKIP 类结果且页面仍处于类目确认页

### Step 5: 点击第二次"确认，下一步"进入编辑表单

**command**:
```bash
curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
  -d '(function(){ var btns = document.querySelectorAll("button"); for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.trim().indexOf("确认") >= 0 && btns[i].textContent.trim().indexOf("下一步") >= 0) { btns[i].scrollIntoView({block:"center"}); btns[i].click(); return "clicked"; } } return "not found"; })()'

sleep 3

curl -s -X POST "http://localhost:3456/eval?target=PUBLISH_ID" \
  -d '(function(){ return JSON.stringify({url: window.location.href, hasForm: document.body.innerText.indexOf("基础信息")>=0 || document.body.innerText.indexOf("销售信息")>=0}); })()'
```
**description**: 在当前版本中，类目确认页通常就是进入完整编辑表单前的最后一步，无需单独处理品牌。点击第二次"确认，下一步"跳转到完整编辑表单。
**verify**: URL 变为 `item.upload.taobao.com/sell/v2/publish.htm`，页面包含基础信息、销售信息、物流服务等表单区块

### Step 6: 先采集当前页面待填写字段，再按采集结果补填

**command**:
```bash
node ${CLAUDE_SKILL_DIR}/scripts/qianniu/collect-publish-form-fields.mjs \
  --target "${PUBLISH_ID}" \
  --output "temp/qianniu-upload-material/publish-field-report.json"

node ${CLAUDE_SKILL_DIR}/scripts/qianniu/fill-publish-form.mjs \
  --target "${PUBLISH_ID}" \
  --product "商品表单 JSON 路径" \
  --field-report "temp/qianniu-upload-material/publish-field-report.json"
```
**description**: 先在 `publish.htm` 采集当前页面可见字段，识别每个字段的标签、是否必填、是否已有值以及可映射的商品键，输出到 `publish-field-report.json`。然后读取本地商品 JSON，只对 **核心商品字段**（标题、导购标题、价格、库存、商家编码、品牌、详情描述）以及 **页面上确实存在且当前缺失/必填** 的属性执行小粒度补填，避免“拿着静态 JSON 整页盲填”。这样既能覆盖当前类目真正需要的信息，也能减少页面改版后的误填和 `Runtime.evaluate` 超时。对 `selectOrText` 类型字段，脚本会先尝试下拉选择，失败后退回文本填写；对 `fields.材质成分` 可使用 `materialComposition` 模式，按数组自动增删行、精确选材质并填写百分比。**注意**：导购标题会阻塞保存，必须满足页面规则：`10-15 个汉字` 或 `20-30 个字符`。
**verify**: 字段采集报告中的 `summary.missingRequired` 能反映当前页面还有多少必填项未填；填充脚本输出 JSON 中 `status` 为 `ok` 或 `partial`，且 `filled` 中能看到已成功写入的字段。若返回 `partial`，优先根据 `publish-field-report.json` 和 `skipped` 中的结果补齐必填项，而不是重跑整页。

### Step 7: 设置“放入仓库”并提交宝贝信息

**command**:
```bash
curl -s -X POST "http://localhost:3456/eval?target=${PUBLISH_ID}" \
  -d '(function(){ var labels=[].slice.call(document.querySelectorAll("label,[role=radio],span,div")); for(var i=0;i<labels.length;i++){ var text=(labels[i].textContent||"").trim(); if(text==="放入仓库" || text.indexOf("放入仓库")>=0){ labels[i].scrollIntoView({block:"center"}); labels[i].click(); return "clicked warehouse"; } } return "warehouse option not found"; })()'

sleep 1

curl -s -X POST "http://localhost:3456/eval?target=${PUBLISH_ID}" \
  -d '(function(){ var btns=[].slice.call(document.querySelectorAll("button")); for(var i=0;i<btns.length;i++){ if(btns[i].textContent.trim()==="提交宝贝信息"){ btns[i].scrollIntoView({block:"center"}); btns[i].click(); return "clicked submit"; } } return "submit not found"; })()'

sleep 4

curl -s -X POST "http://localhost:3456/eval?target=${PUBLISH_ID}" \
  -d '(function(){ var text=document.body.innerText; return JSON.stringify({ submitted: text.indexOf("宝贝已放入仓库")>=0 || text.indexOf("发布成功")>=0 || text.indexOf("仓库中的宝贝")>=0 || window.location.href.indexOf("publish_success")>=0 || window.location.href.indexOf("warehouse")>=0, warehouseSelected: text.indexOf("放入仓库")>=0, hasError: text.indexOf("填写错误")>=0 || text.indexOf("请完善")>=0 || text.indexOf("失败")>=0, text: text.slice(0,1200), url: window.location.href }); })()'
```
**description**: 商品表单填写完成后，不再保存草稿。先把“上架时间”切到“放入仓库”，再点击“提交宝贝信息”，让商品进入“仓库中的宝贝”而不是立即上架。优先通过页面上的单选项直接点击“放入仓库”；若商品 JSON 中已带 `radios: { "上架时间": "放入仓库" }`，Step 6 的自动填充也会提前把该项设好。若提交后页面提示必填缺失或失败，应回到字段采集报告继续补齐，而不是退回草稿方案。
**verify**: 返回结果中 `submitted=true` 且 `hasError=false`。成功后页面通常会出现“宝贝已放入仓库”“仓库中的宝贝”等文案，或 URL 跳转到成功/仓库页；若仍停留在 `publish.htm` 且 `hasError=true`，必须先修正页面报错再重试提交。

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
      "mode": "materialComposition",
      "value": [
        {
          "material": "棉",
          "percent": "95"
        },
        {
          "material": "聚酯纤维",
          "percent": "5"
        }
      ]
    }
  }
}
```
