#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const proxyBase = process.env.CDP_PROXY_BASE || 'http://127.0.0.1:3456';

let targetId = null;
let outputFile = null;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if ((arg === '--target' || arg === '-t') && args[index + 1]) {
    targetId = args[++index];
  } else if ((arg === '--output' || arg === '-o') && args[index + 1]) {
    outputFile = args[++index];
  }
}

if (!targetId) {
  console.error('用法: node scripts/qianniu/collect-publish-form-fields.mjs --target <targetId> [--output <report.json>]');
  process.exit(1);
}

async function proxyJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`代理请求失败 (${res.status}): ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`代理返回非 JSON: ${text.slice(0, 300)}`);
  }
}

async function proxyEval(id, expression) {
  const result = await proxyJson(`${proxyBase}/eval?target=${encodeURIComponent(id)}`, {
    method: 'POST',
    body: expression,
  });
  if (result.error) throw new Error(result.error);
  return result.value;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMatch(value) {
  return normalizeText(value)
    .replace(/[：:＊*]/g, '')
    .toLowerCase();
}

function aliasMap() {
  return new Map([
    ['title', ['商品标题', '宝贝标题', '标题']],
    ['subtitle', ['导购标题', '商品卖点', '卖点', '宝贝卖点', '副标题']],
    ['price', ['价格', '一口价', '售价']],
    ['originalPrice', ['划线价', '原价', '市场价', '吊牌价']],
    ['stock', ['库存', '总库存', '可售库存']],
    ['weight', ['重量', '毛重']],
    ['itemCode', ['商家编码', '商品编码', '货号']],
    ['brand', ['品牌']],
    ['shippingTemplate', ['运费模板', '物流模板']],
    ['description', ['宝贝描述', '商品描述', '详情描述', '商品详情', '宝贝详情']],
  ]);
}

function mappedTaskForLabel(label, fieldType) {
  const normalizedLabel = normalizeMatch(label);
  const exactMatches = [];
  const fuzzyMatches = [];

  for (const [key, aliases] of aliasMap()) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeMatch(alias);
      if (!normalizedAlias) continue;
      if (normalizedAlias === normalizedLabel) exactMatches.push({ key, aliases, alias: normalizedAlias });
      if (normalizedLabel.includes(normalizedAlias) || normalizedAlias.includes(normalizedLabel)) {
        fuzzyMatches.push({ key, aliases, alias: normalizedAlias });
      }
    }
  }

  const matched = exactMatches[0] || fuzzyMatches.sort((left, right) => right.alias.length - left.alias.length)[0];
  if (matched) {
    return {
      key: matched.key,
      labels: matched.aliases,
      mode: fieldType === 'richtext' ? 'richtext' : fieldType === 'radio' ? 'radio' : fieldType === 'checkbox' ? 'checkbox' : fieldType === 'select' ? 'select' : 'text',
    };
  }

  return {
    key: `attribute:${label}`,
    labels: [label],
    mode: fieldType === 'radio' ? 'radio' : fieldType === 'checkbox' ? 'checkbox' : fieldType === 'text' ? 'selectOrText' : fieldType,
  };
}

const expression = `(() => {
  const normalizeText = (value) => String(value || '')
    .replace(/\\s+/g, ' ')
    .trim();

  const visible = (element) => {
    if (!element || !(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && element.getClientRects().length > 0;
  };

  const controlSelector = [
    'input:not([type="hidden"])',
    'textarea',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '.ProseMirror',
    '.ql-editor',
    '[role="combobox"]',
    '.next-select',
    '.next-select-trigger',
    '.next-select-inner',
    '.next-picker',
    '.next-cascader',
    'input[type="radio"]',
    'input[type="checkbox"]'
  ].join(',');

  const lineBlacklist = new Set([
    '*', '重要', '模板', '展开', '点击展开', '查看应用场景', '解析图文详情', '上传图片',
    '从3:4主图裁剪', '从1:1主图裁剪', '编辑新建刷新', '元', '件', '客服', '预览',
    '添加', '图片', '文字', '源码导入', '高级编辑', '清空', '保存为模板'
  ]);
  const placeholderValues = new Set([
    '请选择', '请输入', '选择分类', '模板请选择', '请选择分类', '-', '0/60', '0/30', '0/64', '0/128'
  ]);

  const seen = new Set();
  const roots = [];

  const hasControls = (root) => root.querySelector(controlSelector)
    || root.querySelector('label')
    || root.querySelector('[role="radio"]')
    || root.querySelector('[role="checkbox"]');

  const addRoot = (node) => {
    if (!(node instanceof HTMLElement) || !visible(node)) return;
    let root = node.closest('[id^="struct-"], [id^="sell-field-"]');
    if (!(root instanceof HTMLElement)) {
      root = node;
      for (let depth = 0; depth < 5 && root; depth += 1) {
        if (hasControls(root)) break;
        root = root.parentElement;
      }
    }
    if (!(root instanceof HTMLElement) || !visible(root) || !hasControls(root)) return;
    if (seen.has(root)) return;
    seen.add(root);
    roots.push(root);
  };

  document.querySelectorAll('[id^="struct-"], [id^="sell-field-"]').forEach(addRoot);

  if (!roots.length) {
    document.querySelectorAll('label, th, td').forEach(addRoot);
  }

  const safeLine = (line) => {
    const text = normalizeText(line);
    if (!text) return false;
    if (lineBlacklist.has(text)) return false;
    if (text.length > 40) return false;
    if (/^[0-9]+\\/[0-9]+$/.test(text)) return false;
    if (/^[0-9]+$/.test(text)) return false;
    if (text.includes('最多输入') || text.includes('最多允许输入')) return false;
    if (text.includes('推荐') || text.includes('要求') || text.includes('如何使用')) return false;
    return true;
  };

  const safeValue = (value) => {
    const text = normalizeText(value);
    if (!text) return false;
    if (placeholderValues.has(text)) return false;
    if (lineBlacklist.has(text)) return false;
    if (text.length > 24) return false;
    if (text.includes('请选择') || text.includes('请输入')) return false;
    if (text.includes('查看')) return false;
    if (text.includes('点击')) return false;
    if (text.includes('教程')) return false;
    if (text.includes('推荐')) return false;
    if (text.includes('要求')) return false;
    if (text.includes('规范标价')) return false;
    if (text.includes('最多支持')) return false;
    if (text.includes('已填写')) return false;
    return true;
  };

  const fieldType = (root) => {
    if (root.querySelector('[contenteditable="true"], [role="textbox"], .ProseMirror, .ql-editor')) return 'richtext';
    if (root.querySelector('input[type="radio"]') || root.querySelector('[role="radio"]')) return 'radio';
    if (root.querySelector('input[type="checkbox"]') || root.querySelector('[role="checkbox"]')) return 'checkbox';
    if (root.querySelector('[role="combobox"], .next-select, .next-select-trigger, .next-select-inner, .next-picker, .next-cascader')) return 'select';
    if (root.querySelector('textarea, input:not([type="hidden"])')) return 'text';
    return 'unknown';
  };

  const selectedTexts = (root) => {
    const values = new Set();

    root.querySelectorAll('input:not([type="hidden"]), textarea').forEach((input) => {
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) || !visible(input)) return;
      const value = normalizeText(input.value);
      if (safeValue(value)) values.add(value);
    });

    root.querySelectorAll('[contenteditable="true"], [role="textbox"], .ProseMirror, .ql-editor').forEach((node) => {
      if (!(node instanceof HTMLElement) || !visible(node)) return;
      const value = normalizeText(node.innerText || node.textContent);
      if (safeValue(value)) values.add(value);
    });

    root.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked').forEach((input) => {
      const label = input.closest('label');
      const value = normalizeText((label && label.textContent) || input.value);
      if (safeValue(value)) values.add(value);
    });

    root.querySelectorAll('.next-tag, .next-select-single-value, .next-select-inner-value, .next-select-trigger, [class*="select"] [class*="value"]').forEach((node) => {
      if (!(node instanceof HTMLElement) || !visible(node)) return;
      const value = normalizeText(node.textContent);
      if (safeValue(value)) values.add(value);
    });

    const lines = Array.from(new Set(
      String(root.innerText || root.textContent || '')
        .split(/\\n+/)
        .map((line) => normalizeText(line))
        .filter(Boolean)
    ));

    const label = lines.find(safeLine) || root.id || 'unknown';
    for (const line of lines.slice(1, 10)) {
      if (!safeValue(line)) continue;
      if (line === label) continue;
      if (line.startsWith('已选择')) continue;
      values.add(line);
    }

    return Array.from(values);
  };

  const fields = roots.map((root) => {
    const lines = Array.from(new Set(
      String(root.innerText || root.textContent || '')
        .split(/\\n+/)
        .map((line) => normalizeText(line))
        .filter(Boolean)
    ));

    const label = lines.find(safeLine) || root.id || 'unknown';
    const type = fieldType(root);
    const values = selectedTexts(root)
      .filter((value) => value !== label)
      .filter((value) => !lineBlacklist.has(value))
      .filter((value) => value.length <= 80);

    const required = lines.slice(0, 6).includes('*')
      || root.innerText.includes('\\n*\\n')
      || root.querySelector('[aria-required="true"]')
      || root.querySelector('.required');

    return {
      id: root.id || null,
      label,
      type,
      required: Boolean(required),
      currentValues: Array.from(new Set(values)),
      filled: values.length > 0,
      missing: Boolean(required) && values.length === 0,
      sampleText: lines.slice(0, 12),
    };
  }).filter((field) => field.label && field.label !== 'unknown');

  return JSON.stringify({
    url: location.href,
    title: document.title,
    capturedAt: new Date().toISOString(),
    fields,
  });
})()`;

const raw = await proxyEval(targetId, expression);
const report = JSON.parse(raw);

const merged = new Map();

for (const field of report.fields) {
  const mappedTask = mappedTaskForLabel(field.label, field.type);
  const nextField = {
    ...field,
    currentValues: Array.from(new Set((field.currentValues || []).filter((value) => normalizeText(value)))),
    mappedTask,
  };
  const key = `${normalizeMatch(nextField.label)}::${normalizeMatch(nextField.mappedTask.key)}`;
  const existing = merged.get(key);

  if (!existing) {
    merged.set(key, nextField);
    continue;
  }

  const mergedValues = Array.from(new Set([...(existing.currentValues || []), ...(nextField.currentValues || [])]));
  const required = existing.required || nextField.required;
  const filled = mergedValues.length > 0 || existing.filled || nextField.filled;

  merged.set(key, {
    ...existing,
    id: existing.id || nextField.id,
    type: existing.type !== 'unknown' ? existing.type : nextField.type,
    required,
    currentValues: mergedValues,
    filled,
    missing: required && !filled,
    sampleText: existing.sampleText.length >= nextField.sampleText.length ? existing.sampleText : nextField.sampleText,
  });
}

const mappedFields = Array.from(merged.values());

const finalReport = {
  ...report,
  fields: mappedFields,
  summary: {
    total: mappedFields.length,
    required: mappedFields.filter((field) => field.required).length,
    missingRequired: mappedFields.filter((field) => field.missing).length,
    missingRequiredLabels: mappedFields.filter((field) => field.missing).map((field) => field.label),
  },
};

const output = `${JSON.stringify(finalReport, null, 2)}\n`;

if (outputFile) {
  const resolved = path.resolve(outputFile);
  await fs.writeFile(resolved, output, 'utf8');
}

process.stdout.write(output);
