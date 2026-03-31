#!/usr/bin/env node
// 千牛商品发布页表单自动填充。
// 目标：在 publish.htm 编辑页，根据结构化 JSON 自动填写标题、卖点、价格、库存、属性和详情描述。

import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const proxyBase = process.env.CDP_PROXY_BASE || 'http://127.0.0.1:3456';

let targetId = null;
let productFile = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if ((arg === '--target' || arg === '-t') && args[i + 1]) {
    targetId = args[++i];
  } else if ((arg === '--product' || arg === '-p') && args[i + 1]) {
    productFile = args[++i];
  }
}

if (!targetId || !productFile) {
  console.error('用法: node scripts/qianniu/fill-publish-form.mjs --target <targetId> --product <product.json>');
  process.exit(1);
}

function normalizeTask(mode, labels, value, key) {
  if (value === undefined || value === null || value === '') return null;
  return {
    key,
    mode,
    labels,
    value: String(value),
  };
}

function toTasks(product) {
  const tasks = [];
  const specs = [
    ['title', 'text', ['商品标题', '宝贝标题', '标题']],
    ['subtitle', 'text', ['商品卖点', '卖点', '宝贝卖点', '副标题']],
    ['price', 'text', ['价格', '一口价', '售价']],
    ['originalPrice', 'text', ['划线价', '原价', '市场价']],
    ['stock', 'text', ['库存', '总库存', '可售库存']],
    ['weight', 'text', ['重量', '毛重']],
    ['itemCode', 'text', ['商家编码', '商品编码', '货号']],
    ['brand', 'select', ['品牌']],
    ['shippingTemplate', 'select', ['运费模板', '物流模板']],
    ['description', 'richtext', ['宝贝描述', '商品描述', '详情描述', '商品详情', '宝贝详情']],
  ];

  for (const [key, mode, labels] of specs) {
    const task = normalizeTask(mode, labels, product[key], key);
    if (task) tasks.push(task);
  }

  for (const [label, value] of Object.entries(product.attributes || {})) {
    const task = normalizeTask('selectOrText', [label], value, `attribute:${label}`);
    if (task) tasks.push(task);
  }

  for (const [label, value] of Object.entries(product.selects || {})) {
    const task = normalizeTask('select', [label], value, `select:${label}`);
    if (task) tasks.push(task);
  }

  for (const [label, value] of Object.entries(product.radios || {})) {
    const task = normalizeTask('radio', [label], value, `radio:${label}`);
    if (task) tasks.push(task);
  }

  for (const [label, raw] of Object.entries(product.fields || {})) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      const mode = raw.mode || 'text';
      const labels = Array.isArray(raw.labels) && raw.labels.length ? raw.labels : [label];
      const task = normalizeTask(mode, labels, raw.value, `field:${label}`);
      if (task) tasks.push(task);
    } else {
      const task = normalizeTask('text', [label], raw, `field:${label}`);
      if (task) tasks.push(task);
    }
  }

  return tasks;
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

function pageFillFunctionSource() {
  async function fillPublishForm(payload) {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const report = {
      status: 'ok',
      url: location.href,
      filled: [],
      skipped: [],
    };

    const normalize = (text) => String(text || '')
      .replace(/[\s\r\n\t]+/g, '')
      .replace(/[：:＊*]/g, '')
      .toLowerCase();

    const visible = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    };

    const cleanText = (el) => {
      if (!el) return '';
      return String(el.innerText || el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const matchesAliases = (text, aliases) => {
      const normalized = normalize(text);
      return aliases.some((alias) => normalized.includes(normalize(alias)));
    };

    const dispatchInputEvents = (el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    };

    const setNativeValue = (el, value) => {
      const stringValue = String(value);
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(el, stringValue);
      } else {
        el.value = stringValue;
      }
      dispatchInputEvents(el);
    };

    const queryControls = (root) => {
      if (!root || !(root instanceof Element)) return [];
      const selectors = [
        'input:not([type="hidden"]):not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        '[contenteditable="true"]',
        '[role="textbox"]',
        '.ProseMirror',
        '.ql-editor',
      ];
      return Array.from(root.querySelectorAll(selectors.join(','))).filter(visible);
    };

    const querySelectTriggers = (root) => {
      if (!root || !(root instanceof Element)) return [];
      const selectors = [
        '[role="combobox"]',
        '[aria-haspopup="listbox"]',
        '[aria-haspopup="true"]',
        '.next-select',
        '.next-select-trigger',
        '.next-cascader',
        '.next-cascader-trigger',
        '.next-picker',
        '.next-input',
        'input:not([type="hidden"]):not([disabled])',
        'button',
      ];
      return Array.from(root.querySelectorAll(selectors.join(','))).filter(visible);
    };

    const allLabelCandidates = () => Array.from(document.querySelectorAll(
      'label,span,div,th,td,p,strong,b'
    )).filter((el) => {
      const text = cleanText(el);
      return text && text.length <= 40 && visible(el);
    });

    const scoreContainer = (container) => {
      const controls = queryControls(container).length;
      const textLength = cleanText(container).length;
      if (!controls) return -1;
      if (textLength > 600) return -1;
      return controls * 1000 - textLength;
    };

    const findFieldContainer = (aliases) => {
      const matches = [];
      for (const node of allLabelCandidates()) {
        if (!matchesAliases(cleanText(node), aliases)) continue;

        let current = node;
        for (let depth = 0; depth < 6 && current; depth += 1) {
          if (!(current instanceof Element)) break;
          const score = scoreContainer(current);
          if (score >= 0) {
            matches.push({ container: current, score: score - depth * 10 });
          }
          current = current.parentElement;
        }
      }

      if (!matches.length) return null;

      const seen = new Set();
      const deduped = matches.filter((item) => {
        if (seen.has(item.container)) return false;
        seen.add(item.container);
        return true;
      });

      deduped.sort((a, b) => b.score - a.score);
      return deduped[0].container;
    };

    const findControlByPlaceholder = (aliases) => {
      const nodes = Array.from(document.querySelectorAll(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"], [role="textbox"]'
      )).filter(visible);

      for (const node of nodes) {
        const hint = [
          node.getAttribute('placeholder'),
          node.getAttribute('aria-label'),
          node.getAttribute('name'),
        ].filter(Boolean).join(' ');
        if (hint && matchesAliases(hint, aliases)) return node;
      }
      return null;
    };

    const findChoice = (value, scope = document) => {
      const candidates = Array.from(scope.querySelectorAll(
        '[role="option"], [role="radio"], li, button, label, span, div'
      )).filter((el) => {
        const text = cleanText(el);
        return visible(el) && text && text.length <= 80;
      });

      const exact = candidates.find((el) => normalize(cleanText(el)) === normalize(value));
      if (exact) return exact;
      return candidates.find((el) => normalize(cleanText(el)).includes(normalize(value))) || null;
    };

    const clickNode = (node) => {
      if (!node) return false;
      node.scrollIntoView({ block: 'center', inline: 'center' });
      node.click();
      return true;
    };

    const fillTextControl = (control, value) => {
      if (!control) return false;
      if (control.matches('input, textarea')) {
        setNativeValue(control, value);
        return true;
      }

      control.focus();
      const html = String(value)
        .split(/\n+/)
        .filter(Boolean)
        .map((line) => `<p>${line.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))}</p>`)
        .join('') || `<p>${String(value)}</p>`;
      control.innerHTML = html;
      control.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value), inputType: 'insertText' }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      control.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    };

    const fillSelectLike = async (container, value) => {
      const localChoice = findChoice(value, container);
      if (localChoice) {
        clickNode(localChoice);
        await wait(250);
        return true;
      }

      const triggers = querySelectTriggers(container);
      const trigger = triggers[0] || container;
      clickNode(trigger);
      await wait(300);

      const searchInput = Array.from(document.querySelectorAll(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled])'
      )).filter(visible).find((el) => {
        const placeholder = [
          el.getAttribute('placeholder'),
          el.getAttribute('aria-label'),
          cleanText(el.parentElement),
        ].filter(Boolean).join(' ');
        return normalize(placeholder).includes('请输入') || normalize(placeholder).includes('请选择');
      });

      if (searchInput) {
        setNativeValue(searchInput, value);
        await wait(300);
      }

      const popupChoice = findChoice(value);
      if (popupChoice) {
        clickNode(popupChoice);
        await wait(300);
        return true;
      }

      return false;
    };

    const applyTask = async (task) => {
      const container = findFieldContainer(task.labels);
      const controls = container ? queryControls(container) : [];
      const directControl = controls[0] || findControlByPlaceholder(task.labels);

      if (task.mode === 'radio') {
        const radioScope = container || document;
        const radioChoice = findChoice(task.value, radioScope) || findChoice(task.value);
        if (radioChoice && clickNode(radioChoice)) {
          await wait(200);
          return { ok: true, method: 'radio', label: cleanText(container) || task.labels[0] };
        }
        return { ok: false, reason: 'radio option not found' };
      }

      if (task.mode === 'select') {
        if (!container) return { ok: false, reason: 'field container not found' };
        const ok = await fillSelectLike(container, task.value);
        if (ok) {
          return { ok: true, method: 'select', label: cleanText(container) || task.labels[0] };
        }
        return { ok: false, reason: 'select option not found' };
      }

      if (task.mode === 'richtext') {
        const richControl = directControl || (container ? queryControls(container)[0] : null);
        if (!richControl) return { ok: false, reason: 'richtext control not found' };
        const ok = fillTextControl(richControl, task.value);
        await wait(200);
        return ok
          ? { ok: true, method: 'richtext', label: cleanText(container) || task.labels[0] }
          : { ok: false, reason: 'richtext fill failed' };
      }

      if (task.mode === 'selectOrText') {
        if (container) {
          const selectOk = await fillSelectLike(container, task.value);
          if (selectOk) {
            return { ok: true, method: 'select', label: cleanText(container) || task.labels[0] };
          }
        }

        if (directControl && fillTextControl(directControl, task.value)) {
          await wait(200);
          return { ok: true, method: 'text', label: cleanText(container) || task.labels[0] };
        }

        return { ok: false, reason: 'select/text control not found' };
      }

      if (directControl && fillTextControl(directControl, task.value)) {
        await wait(200);
        return { ok: true, method: 'text', label: cleanText(container) || task.labels[0] };
      }

      return { ok: false, reason: 'text control not found' };
    };

    for (const task of payload.tasks || []) {
      try {
        const result = await applyTask(task);
        if (result.ok) {
          report.filled.push({
            key: task.key,
            label: result.label,
            value: task.value,
            method: result.method,
          });
        } else {
          report.skipped.push({
            key: task.key,
            labels: task.labels,
            value: task.value,
            reason: result.reason,
          });
        }
      } catch (error) {
        report.skipped.push({
          key: task.key,
          labels: task.labels,
          value: task.value,
          reason: error && error.message ? error.message : String(error),
        });
      }
    }

    if (report.filled.length === 0) {
      report.status = 'error';
    } else if (report.skipped.length > 0) {
      report.status = 'partial';
    }

    return report;
  }

  return fillPublishForm.toString();
}

const productPath = path.resolve(productFile);
const productRaw = await fs.readFile(productPath, 'utf8');
const product = JSON.parse(productRaw);
const payload = {
  source: productPath,
  tasks: toTasks(product),
};

if (!payload.tasks.length) {
  console.error('商品参数文件为空，没有可填写的字段');
  process.exit(1);
}

const expression = `(${pageFillFunctionSource()})(${JSON.stringify(payload)})`;
const result = await proxyEval(targetId, expression);

if (!result || typeof result !== 'object') {
  console.error('表单填写返回结果异常');
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));

if (result.status === 'error') {
  process.exit(1);
}
