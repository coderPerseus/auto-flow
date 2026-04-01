#!/usr/bin/env node
// 千牛商品发布页表单自动填充。
// 目标：在 publish.htm 编辑页，根据结构化 JSON 自动填写标题、卖点、价格、库存、属性和详情描述。
// 优化策略：
// 1. 参考 qianniu-auto 的内容脚本实现，优先使用 struct-* / sell-field-* 这类稳定容器定位。
// 2. 将大任务拆成多个小 evaluate，避免重 DOM 页面因单次 Runtime.evaluate 过大而超时。
// 3. 核心字段先走精准定位，再对长尾属性逐项兜底，减少误填。

import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const proxyBase = process.env.CDP_PROXY_BASE || 'http://127.0.0.1:3456';

let targetId = null;
let productFile = null;
let fieldReportFile = null;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if ((arg === '--target' || arg === '-t') && args[i + 1]) {
    targetId = args[++i];
  } else if ((arg === '--product' || arg === '-p') && args[i + 1]) {
    productFile = args[++i];
  } else if ((arg === '--field-report' || arg === '-r') && args[i + 1]) {
    fieldReportFile = args[++i];
  }
}

if (!targetId || !productFile) {
  console.error('用法: node scripts/qianniu/fill-publish-form.mjs --target <targetId> --product <product.json> [--field-report <report.json>]');
  process.exit(1);
}

function normalizeMatch(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[：:＊*]/g, '')
    .toLowerCase();
}

function normalizeTask(mode, labels, value, key) {
  if (value === undefined || value === null || value === '') return null;
  return {
    key,
    mode,
    labels,
    value,
  };
}

function expandLabels(labels = []) {
  const aliasMap = new Map([
    ['商品标题', ['商品标题', '宝贝标题', '标题']],
    ['宝贝标题', ['宝贝标题', '商品标题', '标题']],
    ['标题', ['标题', '宝贝标题', '商品标题']],
    ['商品卖点', ['商品卖点', '导购标题', '卖点', '宝贝卖点', '副标题']],
    ['导购标题', ['导购标题', '商品卖点', '卖点', '宝贝卖点', '副标题']],
    ['卖点', ['卖点', '导购标题', '商品卖点', '宝贝卖点', '副标题']],
    ['价格', ['价格', '一口价', '售价']],
    ['一口价', ['一口价', '价格', '售价']],
    ['库存', ['库存', '总库存', '可售库存']],
    ['总库存', ['总库存', '库存', '可售库存']],
    ['商家编码', ['商家编码', '商品编码']],
    ['商品编码', ['商品编码', '商家编码']],
    ['货号', ['货号', '商家编码', '商品编码']],
    ['领型', ['领型', '领型设计']],
    ['领型设计', ['领型设计', '领型']],
    ['袖长', ['袖长', '袖长类型']],
    ['袖长类型', ['袖长类型', '袖长']],
    ['商品描述', ['商品描述', '详情描述', '商品详情', '宝贝详情', '宝贝描述']],
    ['详情描述', ['详情描述', '商品描述', '商品详情', '宝贝详情', '宝贝描述']],
    ['商品详情', ['商品详情', '详情描述', '商品描述', '宝贝详情', '宝贝描述']],
    ['宝贝详情', ['宝贝详情', '详情描述', '商品描述', '商品详情', '宝贝描述']],
    ['宝贝描述', ['宝贝描述', '详情描述', '商品描述', '商品详情', '宝贝详情']],
  ]);

  const result = [];
  const seen = new Set();
  for (const label of labels) {
    const expanded = aliasMap.get(label) || [label];
    for (const item of expanded) {
      if (!item || seen.has(item)) continue;
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function taskMatchesField(task, field) {
  if (!field) return false;
  const fieldLabel = normalizeMatch(field.label);
  const fieldMappedKey = normalizeMatch(field?.mappedTask?.key);
  const taskKey = normalizeMatch(task.key);

  if (fieldMappedKey && fieldMappedKey === taskKey) return true;

  if (task.key.startsWith('attribute:')) {
    const attributeLabel = normalizeMatch(task.key.slice('attribute:'.length));
    if (attributeLabel === fieldLabel) return true;
  }

  for (const label of expandLabels(task.labels || [])) {
    const normalizedLabel = normalizeMatch(label);
    if (!normalizedLabel) continue;
    if (normalizedLabel === fieldLabel) return true;
    if (fieldLabel.includes(normalizedLabel) || normalizedLabel.includes(fieldLabel)) return true;
  }

  return false;
}

function filterTasksByFieldReport(tasks, fieldReport) {
  const fields = Array.isArray(fieldReport?.fields) ? fieldReport.fields : [];
  if (!fields.length) return tasks;

  const coreKeys = new Set([
    'title',
    'subtitle',
    'price',
    'originalPrice',
    'stock',
    'itemCode',
    'brand',
    'description',
  ]);

  return tasks.flatMap((task) => {
    const matched = fields.filter((field) => taskMatchesField(task, field));
    if (coreKeys.has(task.key)) {
      return [{ ...task, reportFields: matched }];
    }
    if (!matched.length) return [];
    if (!matched.some((field) => field.required || field.missing || !field.filled)) return [];
    return [{ ...task, reportFields: matched }];
  });
}

function mergeUnique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function reportLocatorForTask(task) {
  const fields = Array.isArray(task?.reportFields) ? task.reportFields : [];
  if (!fields.length) return {};

  const structIds = [];
  const fieldIds = [];
  const containerIds = [];

  for (const field of fields) {
    const id = field?.id;
    if (!id) continue;

    if (id.startsWith('struct-')) {
      structIds.push(id);
      containerIds.push(id);
      fieldIds.push(id.replace(/^struct-/, 'sell-field-'));
    } else if (id.startsWith('sell-field-')) {
      fieldIds.push(id);
      const structId = id.replace(/^sell-field-/, 'struct-');
      structIds.push(structId);
      containerIds.push(structId);
    } else {
      containerIds.push(id);
    }
  }

  return {
    structIds: mergeUnique(structIds),
    fieldIds: mergeUnique(fieldIds),
    containerIds: mergeUnique(containerIds),
  };
}

function mergeLocators(base, extra) {
  return {
    labels: mergeUnique([...(base?.labels || []), ...(extra?.labels || [])]),
    placeholders: mergeUnique([...(base?.placeholders || []), ...(extra?.placeholders || [])]),
    structIds: mergeUnique([...(base?.structIds || []), ...(extra?.structIds || [])]),
    fieldIds: mergeUnique([...(base?.fieldIds || []), ...(extra?.fieldIds || [])]),
    containerIds: mergeUnique([...(base?.containerIds || []), ...(extra?.containerIds || [])]),
  };
}

function toTasks(product) {
  const tasks = [];
  const specs = [
    ['title', 'text', ['商品标题', '宝贝标题', '标题']],
    ['subtitle', 'text', ['导购标题', '商品卖点', '卖点', '宝贝卖点', '副标题']],
    ['price', 'text', ['价格', '一口价', '售价']],
    ['originalPrice', 'text', ['划线价', '原价', '市场价']],
    ['stock', 'text', ['库存', '总库存', '可售库存']],
    ['weight', 'text', ['重量', '毛重']],
    ['itemCode', 'text', ['商家编码', '商品编码']],
    ['brand', 'select', ['品牌']],
    ['shippingTemplate', 'select', ['运费模板', '物流模板']],
    ['description', 'richtext', ['宝贝描述', '商品描述', '详情描述', '商品详情', '宝贝详情']],
  ];

  for (const [key, mode, labels] of specs) {
    const task = normalizeTask(mode, expandLabels(labels), product[key], key);
    if (task) tasks.push(task);
  }

  for (const [label, value] of Object.entries(product.attributes || {})) {
    const task = normalizeTask('selectOrText', expandLabels([label]), value, `attribute:${label}`);
    if (task) tasks.push(task);
  }

  for (const [label, value] of Object.entries(product.selects || {})) {
    const task = normalizeTask('select', expandLabels([label]), value, `select:${label}`);
    if (task) tasks.push(task);
  }

  for (const [label, value] of Object.entries(product.radios || {})) {
    const task = normalizeTask('radio', expandLabels([label]), value, `radio:${label}`);
    if (task) tasks.push(task);
  }

  for (const [label, raw] of Object.entries(product.fields || {})) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      const mode = raw.mode || 'text';
      const labels = Array.isArray(raw.labels) && raw.labels.length ? expandLabels(raw.labels) : expandLabels([label]);
      const task = normalizeTask(mode, labels, raw.value, `field:${label}`);
      if (task) tasks.push(task);
    } else {
      const task = normalizeTask('text', expandLabels([label]), raw, `field:${label}`);
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

function pageActionFunctionSource() {
  async function runFillAction(action) {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const normalizeText = (value) => String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    const normalizeMatch = (value) => normalizeText(value)
      .replace(/[：:＊*]/g, '')
      .toLowerCase();

    const visible = (element) => {
      if (!element || !(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && element.getClientRects().length > 0;
    };

    const clickElement = (element) => {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus();
      element.click();
    };

    const dispatchInputEvents = (input) => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    };

    const setInputValue = (input, value) => {
      input.scrollIntoView({ block: 'center', inline: 'center' });
      input.focus();
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      const setter = descriptor && descriptor.set;
      if (setter) {
        setter.call(input, String(value));
      } else {
        input.value = String(value);
      }
      dispatchInputEvents(input);
    };

    const setRichtextValue = (element, value) => {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus();
      const html = String(value)
        .split(/\n+/)
        .filter(Boolean)
        .map((line) => `<p>${line.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))}</p>`)
        .join('') || `<p>${String(value)}</p>`;
      element.innerHTML = html;
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: String(value),
        inputType: 'insertText',
      }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
    };

    const matchesAny = (text, labels) => {
      const normalized = normalizeMatch(text);
      return (labels || []).some((label) => normalized.includes(normalizeMatch(label)));
    };

    const allInputs = (root = document) => Array.from(root.querySelectorAll(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled])'
    )).filter((element) => visible(element));

    const allTextControls = (root = document) => Array.from(root.querySelectorAll(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"], [role="textbox"], .ProseMirror, .ql-editor'
    )).filter((element) => visible(element));

    const findFirstVisibleInput = (root) => {
      const inputs = allInputs(root);
      return inputs[0] || null;
    };

    const findFirstVisibleTextControl = (root) => {
      const controls = allTextControls(root);
      return controls[0] || null;
    };

    const findByPlaceholders = (placeholders = []) => {
      const expected = placeholders.map((item) => normalizeText(item)).filter(Boolean);
      if (!expected.length) return null;

      for (const input of allTextControls(document)) {
        const candidates = [
          input.getAttribute('placeholder'),
          input.getAttribute('aria-label'),
          input.getAttribute('name'),
        ].map((item) => normalizeText(item)).filter(Boolean);

        if (candidates.some((candidate) => expected.includes(candidate))) {
          return input;
        }
      }

      return null;
    };

    const findRootByIds = (ids = []) => {
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element instanceof HTMLElement) {
          return element;
        }
      }
      return null;
    };

    const findLabeledContainer = (labels = []) => {
      const candidates = Array.from(document.querySelectorAll(
        'label,span,div,p,strong,b,th,td'
      )).filter((element) => visible(element) && normalizeText(element.textContent).length <= 40);

      let best = null;
      for (const node of candidates) {
        const text = normalizeText(node.textContent);
        if (!matchesAny(text, labels)) continue;

        let current = node;
        for (let depth = 0; depth < 6 && current; depth += 1) {
          if (!(current instanceof HTMLElement)) break;
          const controls = allTextControls(current);
          const currentText = normalizeText(current.innerText || current.textContent);
          if (!controls.length || currentText.length > 220) {
            current = current.parentElement;
            continue;
          }

          const score = currentText.length + depth * 8 + (controls.length - 1) * 25;
          if (!best || score < best.score) {
            best = { score, container: current };
          }
          current = current.parentElement;
        }
      }

      return best ? best.container : null;
    };

    const findActionRoot = () => {
      const locator = action.locator || {};
      return findRootByIds(locator.containerIds)
        || findRootByIds(locator.fieldIds)
        || findRootByIds(locator.structIds)
        || findLabeledContainer(locator.labels);
    };

    const findSelectTrigger = (root) => {
      if (!root) return null;
      const selectors = [
        '[role="combobox"]',
        '.next-select',
        '.next-select-trigger-search',
        '.next-select-trigger',
        '.next-select-inner',
        '.next-picker',
        '.next-cascader',
        'input:not([type="hidden"]):not([disabled])',
        'button',
      ];

      for (const selector of selectors) {
        const node = root.querySelector(selector);
        if (node instanceof HTMLElement && visible(node)) {
          return node;
        }
      }
      return root instanceof HTMLElement && visible(root) ? root : null;
    };

    const findOpenedSelectOverlay = () => {
      const overlays = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened'));
      for (let index = overlays.length - 1; index >= 0; index -= 1) {
        const overlay = overlays[index];
        if (overlay instanceof HTMLElement && visible(overlay)) {
          return overlay;
        }
      }
      return null;
    };

    const waitForOpenedSelectOverlay = async (previousOverlay, label) => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const overlay = findOpenedSelectOverlay();
        if (overlay && overlay !== previousOverlay) {
          return overlay;
        }
        await wait(150);
      }
      throw new Error(`未找到属性下拉框：${label}`);
    };

    const overlayOptions = (overlay) => Array.from(
      overlay.querySelectorAll('.options-item, .next-menu-item, li[role="option"], [role="option"]')
    ).filter((item) => {
      if (!(item instanceof HTMLElement) || !visible(item)) return false;
      if (item.classList.contains('disabled') || item.getAttribute('aria-disabled') === 'true') return false;
      return true;
    });

    const optionText = (item) => {
      if (!(item instanceof HTMLElement)) return '';
      return normalizeText(
        item.getAttribute('title')
          || item.querySelector('.info-content')?.textContent
          || item.textContent
      );
    };

    const findOverlayOption = (overlay, value) => {
      const exact = overlayOptions(overlay).find((item) => normalizeMatch(optionText(item)) === normalizeMatch(value));
      if (exact) return exact;
      return overlayOptions(overlay).find((item) => normalizeMatch(optionText(item)).includes(normalizeMatch(value))) || null;
    };

    const findOverlayScrollContainer = (overlay) => {
      const selectors = [
        '.options-content',
        '.next-menu-content',
        '.next-select-menu',
        '.next-list-content',
        '.next-menu',
      ];
      for (const selector of selectors) {
        const node = overlay.querySelector(selector);
        if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight) {
          return node;
        }
      }
      return overlay instanceof HTMLElement ? overlay : null;
    };

    const findOverlayOptionByScroll = async (overlay, value, { allowContains = true } = {}) => {
      const exact = overlayOptions(overlay).find((item) => normalizeMatch(optionText(item)) === normalizeMatch(value));
      if (exact) return exact;

      const scroller = findOverlayScrollContainer(overlay);
      if (!(scroller instanceof HTMLElement)) {
        return allowContains ? findOverlayOption(overlay, value) : null;
      }

      scroller.scrollTop = 0;
      await wait(120);

      let stagnant = 0;
      let lastTop = -1;
      while (stagnant < 3) {
        const visibleExact = overlayOptions(overlay).find((item) => normalizeMatch(optionText(item)) === normalizeMatch(value));
        if (visibleExact) return visibleExact;

        const nextTop = Math.min(
          scroller.scrollTop + Math.max(220, scroller.clientHeight - 40),
          Math.max(0, scroller.scrollHeight - scroller.clientHeight),
        );

        if (nextTop === lastTop || nextTop === scroller.scrollTop) {
          stagnant += 1;
        } else {
          stagnant = 0;
          scroller.scrollTop = nextTop;
          lastTop = nextTop;
        }
        await wait(160);
      }

      scroller.scrollTop = 0;
      await wait(120);
      return allowContains ? findOverlayOption(overlay, value) : null;
    };

    const closeOpenedSelectOverlay = async (trigger) => {
      const currentOverlay = findOpenedSelectOverlay();
      if (!currentOverlay) return;

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }));
      await wait(150);

      if (!findOpenedSelectOverlay()) return;
      if (trigger) {
        clickElement(trigger);
        await wait(150);
      }

      if (!findOpenedSelectOverlay()) return;
      document.body.click();
      await wait(150);
    };

    const findLabeledOption = (root, value, type) => {
      const candidates = Array.from(root.querySelectorAll(type === 'radio' ? 'label,[role="radio"]' : 'label,[role="checkbox"]'));
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement) || !visible(candidate)) continue;
        const text = normalizeText(candidate.textContent);
        if (text === value || text.includes(value)) return candidate;
      }
      return null;
    };

    const isRadioChecked = (option) => {
      const input = option.querySelector('input[type="radio"]');
      if (input instanceof HTMLInputElement) {
        return input.checked || input.getAttribute('aria-checked') === 'true';
      }
      const wrapper = option.querySelector('.next-radio-wrapper');
      return wrapper instanceof HTMLElement && wrapper.classList.contains('checked');
    };

    const isCheckboxChecked = (option) => {
      const input = option.querySelector('input[type="checkbox"]');
      if (input instanceof HTMLInputElement) {
        return input.checked || input.getAttribute('aria-checked') === 'true';
      }
      const wrapper = option.querySelector('.next-checkbox-wrapper');
      return wrapper instanceof HTMLElement && wrapper.classList.contains('checked');
    };

    const fillText = async () => {
      const locator = action.locator || {};
      const control = findByPlaceholders(locator.placeholders) || findFirstVisibleInput(findActionRoot());
      if (!control) throw new Error('text control not found');
      setInputValue(control, action.value);
      await wait(120);
      return {
        ok: true,
        method: 'text',
        label: (locator.labels || locator.placeholders || [action.key])[0],
        value: control.value || control.textContent || '',
      };
    };

    const fillRichtext = async () => {
      const locator = action.locator || {};
      const root = findActionRoot();
      const control = findByPlaceholders(locator.placeholders) || findFirstVisibleTextControl(root);
      if (!control) throw new Error('richtext control not found');

      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        setInputValue(control, action.value);
      } else {
        setRichtextValue(control, action.value);
      }
      await wait(120);
      return {
        ok: true,
        method: 'richtext',
        label: (locator.labels || [action.key])[0],
      };
    };

    const fillSelect = async () => {
      const locator = action.locator || {};
      const root = findActionRoot();
      if (!root) throw new Error('field container not found');

      const trigger = findByPlaceholders(locator.placeholders) || findSelectTrigger(root);
      if (!trigger) throw new Error('select trigger not found');

      const inlineOptions = overlayOptions(root);
      const inlineMatch = inlineOptions.find((item) => normalizeMatch(optionText(item)) === normalizeMatch(action.value));
      if (inlineMatch) {
        clickElement(inlineMatch);
        await wait(150);
        return {
          ok: true,
          method: 'select',
          label: (locator.labels || [action.key])[0],
        };
      }

      const previousOverlay = findOpenedSelectOverlay();
      clickElement(trigger);
      await wait(150);

      const overlay = findOpenedSelectOverlay() && findOpenedSelectOverlay() !== previousOverlay
        ? findOpenedSelectOverlay()
        : await waitForOpenedSelectOverlay(previousOverlay, (locator.labels || [action.key])[0]);

      const searchInput = allInputs(overlay).find((input) => {
        const hint = normalizeText(
          input.getAttribute('placeholder')
            || input.getAttribute('aria-label')
            || input.getAttribute('name')
        );
        return hint.includes('请输入') || hint.includes('请选择');
      });

      if (searchInput) {
        setInputValue(searchInput, action.value);
        await wait(250);
      }

      const option = findOverlayOption(overlay, action.value);
      if (!option) throw new Error(`select option not found: ${action.value}`);
      clickElement(option);
      await wait(150);

      if (findOpenedSelectOverlay()) {
        await closeOpenedSelectOverlay(trigger);
      }

      return {
        ok: true,
        method: 'select',
        label: (locator.labels || [action.key])[0],
      };
    };

    const fillRadio = async () => {
      const locator = action.locator || {};
      const root = findActionRoot();
      if (!root) throw new Error('radio field container not found');
      const option = findLabeledOption(root, action.value, 'radio');
      if (!option) throw new Error(`radio option not found: ${action.value}`);
      if (!isRadioChecked(option)) {
        clickElement(option);
        await wait(120);
      }
      return {
        ok: true,
        method: 'radio',
        label: (locator.labels || [action.key])[0],
      };
    };

    const fillCheckbox = async () => {
      const locator = action.locator || {};
      const root = findActionRoot();
      if (!root) throw new Error('checkbox field container not found');
      const option = findLabeledOption(root, action.value, 'checkbox');
      if (!option) throw new Error(`checkbox option not found: ${action.value}`);
      if (!isCheckboxChecked(option)) {
        clickElement(option);
        await wait(120);
      }
      return {
        ok: true,
        method: 'checkbox',
        label: (locator.labels || [action.key])[0],
      };
    };

    const fillMaterialComposition = async () => {
      const locator = action.locator || {};
      const root = findActionRoot();
      const items = Array.isArray(action.value) ? action.value : [];
      if (!root) throw new Error('material field container not found');
      if (!items.length) throw new Error('material items are empty');

      const getRows = () => Array.from(root.querySelectorAll('.material-item'))
        .filter((row) => row instanceof HTMLElement && visible(row));
      const getAddButton = () => root.querySelector('button.add-new');
      const getDeleteButton = (row) => row.querySelector('a.delete');
      const getPercentInput = (row) => row.querySelector('input[placeholder="输入含量"]');
      const getSelectedMaterial = (row) => normalizeText(
        row.querySelector('em')?.textContent
          || row.querySelector('input[role="combobox"]')?.value
          || ''
      );

      while (getRows().length > items.length) {
        const rows = getRows();
        const deleteButton = rows.length ? getDeleteButton(rows[rows.length - 1]) : null;
        if (!(deleteButton instanceof HTMLElement)) break;
        clickElement(deleteButton);
        await wait(180);
      }

      while (getRows().length < items.length) {
        const addButton = getAddButton();
        if (!(addButton instanceof HTMLElement)) {
          throw new Error('material add button not found');
        }
        clickElement(addButton);
        await wait(180);
      }

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index] || {};
        const materialName = String(item.material || item.name || item.label || '').trim();
        const percentValue = item.percent === undefined || item.percent === null ? '' : String(item.percent).trim();
        if (!materialName) {
          throw new Error(`material name missing at row ${index + 1}`);
        }

        let row = getRows()[index];
        if (!(row instanceof HTMLElement)) {
          throw new Error(`material row not found: ${index + 1}`);
        }

        if (normalizeMatch(getSelectedMaterial(row)) !== normalizeMatch(materialName)) {
          const trigger = row.querySelector('.next-select,.next-select-inner,[role="combobox"]');
          if (!(trigger instanceof HTMLElement)) {
            throw new Error(`material select trigger not found: ${index + 1}`);
          }

          const previousOverlay = findOpenedSelectOverlay();
          clickElement(trigger);
          await wait(150);

          const overlay = findOpenedSelectOverlay() && findOpenedSelectOverlay() !== previousOverlay
            ? findOpenedSelectOverlay()
            : await waitForOpenedSelectOverlay(previousOverlay, materialName);

          const option = await findOverlayOptionByScroll(overlay, materialName, { allowContains: false });
          if (!option) {
            throw new Error(`material option not found: ${materialName}`);
          }

          clickElement(option);
          await wait(180);

          if (findOpenedSelectOverlay()) {
            await closeOpenedSelectOverlay(trigger);
          }
        }

        row = getRows()[index];
        if (percentValue) {
          const percentInput = getPercentInput(row);
          if (!(percentInput instanceof HTMLInputElement)) {
            throw new Error(`material percent input not found: ${materialName}`);
          }
          setInputValue(percentInput, percentValue);
          await wait(120);
        }
      }

      return {
        ok: true,
        method: 'materialComposition',
        label: (locator.labels || [action.key])[0],
        rows: getRows().map((row) => ({
          material: getSelectedMaterial(row),
          percent: getPercentInput(row)?.value || '',
        })),
      };
    };

    if (!action || !action.type) {
      throw new Error('invalid action');
    }

    if (action.type === 'fill_text') return fillText();
    if (action.type === 'fill_select') return fillSelect();
    if (action.type === 'fill_radio') return fillRadio();
    if (action.type === 'fill_checkbox') return fillCheckbox();
    if (action.type === 'fill_richtext') return fillRichtext();
    if (action.type === 'fill_material_composition') return fillMaterialComposition();

    throw new Error(`unsupported action type: ${action.type}`);
  }

  return runFillAction.toString();
}

function actionForTask(task) {
  const labels = expandLabels(task.labels || []);
  const locator = mergeLocators({ labels }, reportLocatorForTask(task));

  if (task.key === 'title') {
    return {
      type: 'fill_text',
      key: task.key,
      value: task.value,
      locator: {
        ...locator,
        placeholders: ['最多允许输入30个汉字（60字符）'],
        structIds: ['struct-title'],
      },
    };
  }

  if (task.key === 'subtitle') {
    return {
      type: 'fill_text',
      key: task.key,
      value: task.value,
      locator: {
        ...locator,
        placeholders: ['最多输入30字符（15个汉字）'],
      },
    };
  }

  if (task.key === 'price') {
    return {
      type: 'fill_text',
      key: task.key,
      value: task.value,
      locator: {
        ...locator,
        structIds: ['struct-price'],
      },
    };
  }

  if (task.key === 'stock') {
    return {
      type: 'fill_text',
      key: task.key,
      value: task.value,
      locator: {
        ...locator,
        containerIds: ['struct-quantity'],
        fieldIds: ['sell-field-batchInventory-card'],
      },
    };
  }

  if (task.key === 'itemCode') {
    return {
      type: 'fill_text',
      key: task.key,
      value: task.value,
      locator,
    };
  }

  if (task.key === 'description') {
    return {
      type: 'fill_richtext',
      key: task.key,
      value: task.value,
      locator,
    };
  }

  if (task.key === 'field:材质成分' || task.mode === 'materialComposition') {
    return {
      type: 'fill_material_composition',
      key: task.key,
      value: Array.isArray(task.value) ? task.value : [],
      locator: {
        ...locator,
        structIds: mergeUnique(['struct-p-149422948', ...(locator.structIds || [])]),
        fieldIds: mergeUnique(['sell-field-p-149422948', ...(locator.fieldIds || [])]),
      },
    };
  }

  if (task.key === 'brand' || task.key === 'shippingTemplate' || task.mode === 'select') {
    return {
      type: 'fill_select',
      key: task.key,
      value: task.value,
      locator: task.key === 'shippingTemplate'
        ? { ...locator, structIds: ['struct-tbExtractWay'] }
        : locator,
    };
  }

  if (task.mode === 'radio') {
    return {
      type: 'fill_radio',
      key: task.key,
      value: task.value,
      locator,
    };
  }

  if (task.mode === 'checkbox') {
    return {
      type: 'fill_checkbox',
      key: task.key,
      value: task.value,
      locator,
    };
  }

  if (task.mode === 'richtext') {
    return {
      type: 'fill_richtext',
      key: task.key,
      value: task.value,
      locator,
    };
  }

  if (task.mode === 'selectOrText') {
    return {
      primary: {
        type: 'fill_select',
        key: task.key,
        value: task.value,
        locator,
      },
      fallback: {
        type: 'fill_text',
        key: task.key,
        value: task.value,
        locator,
      },
    };
  }

  return {
    type: 'fill_text',
    key: task.key,
    value: task.value,
    locator,
  };
}

async function runAction(action) {
  const expression = `(${pageActionFunctionSource()})(${JSON.stringify(action)})`;
  return proxyEval(targetId, expression);
}

async function runTask(task) {
  const planned = actionForTask(task);

  if (planned.primary && planned.fallback) {
    try {
      const result = await runAction(planned.primary);
      return {
        ok: true,
        method: result.method || 'select',
        label: result.label || task.labels[0],
      };
    } catch (primaryError) {
      try {
        const result = await runAction(planned.fallback);
        return {
          ok: true,
          method: result.method || 'text',
          label: result.label || task.labels[0],
          fallbackFrom: primaryError instanceof Error ? primaryError.message : String(primaryError),
        };
      } catch (fallbackError) {
        return {
          ok: false,
          reason: `select failed: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}; text failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        };
      }
    }
  }

  try {
    const result = await runAction(planned);
    return {
      ok: true,
      method: result.method || planned.type.replace('fill_', ''),
      label: result.label || task.labels[0],
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

const productPath = path.resolve(productFile);
const productRaw = await fs.readFile(productPath, 'utf8');
const product = JSON.parse(productRaw);
let tasks = toTasks(product);

if (fieldReportFile) {
  const reportPath = path.resolve(fieldReportFile);
  const reportRaw = await fs.readFile(reportPath, 'utf8');
  const fieldReport = JSON.parse(reportRaw);
  tasks = filterTasksByFieldReport(tasks, fieldReport);
}

if (!tasks.length) {
  console.error('根据商品参数和页面采集结果，没有可填写的字段');
  process.exit(1);
}

const report = {
  status: 'ok',
  url: null,
  filled: [],
  skipped: [],
};

for (const task of tasks) {
  const result = await runTask(task);
  if (result.ok) {
    report.filled.push({
      key: task.key,
      label: result.label,
      value: task.value,
      method: result.method,
      ...(result.fallbackFrom ? { fallbackFrom: result.fallbackFrom } : {}),
    });
  } else {
    report.skipped.push({
      key: task.key,
      labels: task.labels,
      value: task.value,
      reason: result.reason,
    });
  }
}

try {
  report.url = await proxyEval(targetId, 'location.href');
} catch {
  report.url = null;
}

if (report.filled.length === 0) {
  report.status = 'error';
} else if (report.skipped.length > 0) {
  report.status = 'partial';
}

console.log(JSON.stringify(report, null, 2));

if (report.status === 'error') {
  process.exit(1);
}
