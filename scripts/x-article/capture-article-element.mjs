#!/usr/bin/env node
// 精确截图 X Article 页面中的嵌入 article 元素。
// 用法:
//   node capture-article-element.mjs --target <targetId> --output <path>
//     [--status-url <url>] [--child-index <n>] [--article-index <n>]
//     [--padding <px>] [--wait-ms <ms>]

import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
let targetId = null;
let outputPath = null;
let statusUrl = null;
let childIndex = null;
let articleIndex = null;
let padding = 12;
let waitMs = 800;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--target' && args[i + 1]) {
    targetId = args[++i];
  } else if (arg === '--output' && args[i + 1]) {
    outputPath = args[++i];
  } else if (arg === '--status-url' && args[i + 1]) {
    statusUrl = args[++i];
  } else if (arg === '--child-index' && args[i + 1]) {
    childIndex = Number(args[++i]);
  } else if (arg === '--article-index' && args[i + 1]) {
    articleIndex = Number(args[++i]);
  } else if (arg === '--padding' && args[i + 1]) {
    padding = Number(args[++i]);
  } else if (arg === '--wait-ms' && args[i + 1]) {
    waitMs = Number(args[++i]);
  }
}

if (!targetId || !outputPath) {
  console.error('用法: node capture-article-element.mjs --target <targetId> --output <path> [--status-url <url>] [--child-index <n>] [--article-index <n>]');
  process.exit(1);
}

const proxyBase = 'http://127.0.0.1:3456';

function safeParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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

async function proxyEval(expression) {
  const result = await proxyJson(`${proxyBase}/eval?target=${encodeURIComponent(targetId)}`, {
    method: 'POST',
    body: expression,
  });
  if (result.error) throw new Error(result.error);
  return safeParse(result.value);
}

function buildLocateExpression(locator) {
  return `(() => new Promise(async (resolve) => {
    const statusUrl = ${JSON.stringify(locator.statusUrl)};
    const childIndex = ${locator.childIndex === null ? 'null' : String(locator.childIndex)};
    const articleIndex = ${locator.articleIndex === null ? 'null' : String(locator.articleIndex)};
    const padding = ${Number.isFinite(locator.padding) ? locator.padding : 12};
    const waitMs = ${Number.isFinite(locator.waitMs) ? locator.waitMs : 800};

    const normalizeUrl = (value) => {
      if (!value) return null;
      try {
        const url = new URL(value, location.href);
        url.hash = '';
        return url.href;
      } catch {
        return value;
      }
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

    const heading = Array.from(document.querySelectorAll('h2')).find((node) => node.innerText.includes('My Mental Model'));
    const content = heading?.parentElement?.parentElement || null;
    const contentChildren = content ? Array.from(content.children) : [];
    const sections = contentChildren.filter((node) => node.tagName === 'SECTION');
    const allSections = Array.from(document.querySelectorAll('section'));

    const sectionMatchesStatus = (section) => {
      const hrefs = Array.from(section.querySelectorAll('a[href]')).map((a) => normalizeUrl(a.href)).filter(Boolean);
      return hrefs.includes(normalizeUrl(statusUrl));
    };

    let section = null;
    let resolvedBy = null;

    if (statusUrl) {
      section = sections.find(sectionMatchesStatus) || allSections.find(sectionMatchesStatus) || null;
      if (section) resolvedBy = 'status-url';
    }

    if (!section && Number.isInteger(childIndex) && childIndex >= 0) {
      const candidate = contentChildren[childIndex] || null;
      if (candidate) {
        section = candidate.tagName === 'SECTION' ? candidate : candidate.closest('section');
        resolvedBy = 'child-index';
      }
    }

    if (!section && Number.isInteger(articleIndex) && articleIndex >= 0) {
      const article = Array.from(document.querySelectorAll('article'))[articleIndex] || null;
      if (article) {
        section = article.closest('section') || article;
        resolvedBy = 'article-index';
      }
    }

    const target = section?.querySelector('article') || section;
    if (!target) {
      resolve(JSON.stringify({
        error: '未找到目标 article 元素',
        requested: { statusUrl, childIndex, articleIndex },
        contentChildCount: contentChildren.length,
        sectionCount: sections.length,
      }));
      return;
    }

    const settle = async () => {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch {}
      }
      const images = Array.from(target.querySelectorAll('img'));
      await Promise.all(images.map((img) => {
        if (typeof img.decode === 'function') {
          return img.decode().catch(() => {});
        }
        if (img.complete) return Promise.resolve();
        return new Promise((done) => {
          const finish = () => done();
          img.addEventListener('load', finish, { once: true });
          img.addEventListener('error', finish, { once: true });
          setTimeout(finish, 1500);
        });
      }));
      await nextFrame();
      await nextFrame();
      if (waitMs > 0) await sleep(waitMs);
    };

    let rect;
    let visible = false;
    let hitTag = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      await settle();
      rect = target.getBoundingClientRect();
      const cx = Math.min(window.innerWidth - 1, Math.max(1, rect.left + rect.width / 2));
      const cy = Math.min(window.innerHeight - 1, Math.max(1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(cx, cy);
      hitTag = hit?.tagName || null;
      visible = !!hit && (target === hit || target.contains(hit));
      if (visible && rect.width > 0 && rect.height > 0) break;
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }

    rect = target.getBoundingClientRect();
    const scroll = {
      x: window.scrollX,
      y: window.scrollY,
    };

    const clip = {
      x: Math.max(0, Math.floor(scroll.x + rect.left - padding)),
      y: Math.max(0, Math.floor(scroll.y + rect.top - padding)),
      width: Math.ceil(rect.width + padding * 2),
      height: Math.ceil(rect.height + padding * 2),
    };

    const hrefs = Array.from(target.querySelectorAll('a[href]')).map((a) => normalizeUrl(a.href)).filter(Boolean);
    const text = (target.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 280);

    resolve(JSON.stringify({
      resolvedBy,
      statusUrl,
      childIndex,
      articleIndex,
      hrefs,
      visible,
      hitTag,
      clip,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      scroll,
      text,
    }));
  }))()`;
}

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await proxyJson(`${proxyBase}/activate?target=${encodeURIComponent(targetId)}`);

const meta = await proxyEval(buildLocateExpression({
  statusUrl,
  childIndex: Number.isInteger(childIndex) ? childIndex : null,
  articleIndex: Number.isInteger(articleIndex) ? articleIndex : null,
  padding,
  waitMs,
}));

if (!meta || meta.error) {
  throw new Error(meta?.error || '截图前定位失败');
}

if (!meta.visible) {
  throw new Error(`目标 article 未稳定暴露在视口内，hit=${meta.hitTag || 'unknown'}`);
}

if (!meta.clip || meta.clip.width <= 0 || meta.clip.height <= 0) {
  throw new Error('截图裁剪区域无效');
}

const clip = [meta.clip.x, meta.clip.y, meta.clip.width, meta.clip.height].join(',');
await proxyJson(
  `${proxyBase}/screenshot?target=${encodeURIComponent(targetId)}&file=${encodeURIComponent(path.resolve(outputPath))}&clip=${encodeURIComponent(clip)}&format=png`
);

console.log(JSON.stringify({
  ...meta,
  output: path.resolve(outputPath),
}, null, 2));
