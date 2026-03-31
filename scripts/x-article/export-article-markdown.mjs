#!/usr/bin/env node
// 将 X Article 导出为 Markdown。
// 重点修复：
// - 嵌入 article 改为精确定位 section/article 元素后裁剪截图并上传
// - 文章内图片 section 不再打开 /media 页面取第一张图，改为按当前 carousel slide 解析对应媒体地址

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import TurndownService from 'turndown';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);

let articleUrl = null;
let outputPath = null;
let picgoConfig = null;
let workflowName = 'x-article-translate';

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!articleUrl && !arg.startsWith('--')) {
    articleUrl = arg;
  } else if (arg === '--output' && args[i + 1]) {
    outputPath = args[++i];
  } else if (arg === '--picgo-config' && args[i + 1]) {
    picgoConfig = args[++i];
  } else if (arg === '--workflow-name' && args[i + 1]) {
    workflowName = args[++i];
  }
}

if (!articleUrl) {
  console.error('用法: node export-article-markdown.mjs <x-article-url> [--output <path>] [--picgo-config <path>]');
  process.exit(1);
}

const proxyBase = 'http://127.0.0.1:3456';
const cwd = process.cwd();
const baseDir = outputPath
  ? path.dirname(path.resolve(outputPath))
  : path.resolve('temp', workflowName);
const assetsDir = path.join(baseDir, 'assets');
const logsDir = path.join(baseDir, 'logs');
const downloadsDir = path.join(baseDir, 'downloads');

await fs.mkdir(assetsDir, { recursive: true });
await fs.mkdir(logsDir, { recursive: true });
await fs.mkdir(downloadsDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeParse = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

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

async function proxyEval(targetId, expression) {
  const result = await proxyJson(`${proxyBase}/eval?target=${encodeURIComponent(targetId)}`, {
    method: 'POST',
    body: expression,
  });
  if (result.error) throw new Error(result.error);
  return safeParse(result.value);
}

async function newTarget(url) {
  const result = await proxyJson(`${proxyBase}/new?url=${encodeURIComponent(url)}`);
  return result.targetId;
}

async function closeTarget(targetId) {
  try {
    await proxyJson(`${proxyBase}/close?target=${encodeURIComponent(targetId)}`);
  } catch {
    // 非关键路径，忽略
  }
}

async function runNode(scriptPath, scriptArgs) {
  const { stdout } = await execFileAsync('node', [scriptPath, ...scriptArgs], { cwd });
  return stdout.trim();
}

async function uploadAsset(localPath) {
  try {
    const args = [localPath];
    if (picgoConfig) args.push('--picgo-config', picgoConfig);
    const stdout = await runNode(path.resolve('scripts/x-article/picgo-upload.mjs'), args);
    return stdout.split('\n').filter(Boolean).at(-1) || null;
  } catch {
    return null;
  }
}

async function downloadImage(url, localPath) {
  await runNode(path.resolve('scripts/x-article/download-image.mjs'), [url, '--output', localPath]);
}

function normalizeXImageUrl(url) {
  if (!url) return null;
  return url.replace(/([?&])name=[^&]+/, '$1name=orig');
}

async function resolveArticleSectionImage(mediaHref) {
  const targetId = await newTarget(mediaHref);
  try {
    await sleep(5000);
    const data = await proxyEval(targetId, `(() => {
      const slideMatch = document.body.innerText.match(/Slide (\\d+) of (\\d+) - Carousel/);
      const imgs = Array.from(document.querySelectorAll('img'))
        .map((node) => node.currentSrc || node.src)
        .filter((src) => src && src.includes('pbs.twimg.com/media/'));

      return JSON.stringify({
        href: location.href,
        slide: slideMatch ? { current: Number(slideMatch[1]), total: Number(slideMatch[2]) } : null,
        imgs: Array.from(new Set(imgs)),
      });
    })()`);

    const imgs = (data.imgs || []).map((src) => normalizeXImageUrl(src)).filter(Boolean);
    if (imgs.length === 0) return null;

    const slideIndex = data.slide?.current ? Math.max(0, data.slide.current - 1) : 0;
    const chosen = imgs[Math.min(slideIndex, imgs.length - 1)];
    return {
      chosen,
      candidates: imgs,
      slide: data.slide || null,
    };
  } finally {
    await closeTarget(targetId);
  }
}

function buildTurndown() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
  turndown.remove(['style', 'script']);
  return turndown;
}

function cleanMarkdown(text) {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^(#{1,6})\s*\n+([^\n])/gm, '$1 $2')
    .trim();
}

function normalizeHtmlForTurndown(html) {
  return html
    // X Article / Draft.js 会把段内链接包在独立 div 里，turndown 会把它们当块级元素拆段。
    // 这里先拆掉只包含单个链接的包装层，恢复成真正的内联链接。
    .replace(/<div\b[^>]*>\s*(<a\b[\s\S]*?<\/a>)\s*<\/div>/g, '$1');
}

function fileSafeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

const turndown = buildTurndown();
const targetId = await newTarget(articleUrl);

try {
  await sleep(5000);
  for (let i = 0; i < 12; i++) {
    await proxyJson(`${proxyBase}/scroll?target=${encodeURIComponent(targetId)}&direction=down&y=3000`);
    await sleep(1000);
  }
  await proxyJson(`${proxyBase}/scroll?target=${encodeURIComponent(targetId)}&direction=top`);

  const pageData = await proxyEval(targetId, `(() => {
    const lines = document.body.innerText.split("\\n").map((s) => s.trim()).filter(Boolean);
    const noise = new Set(["To view keyboard shortcuts, press question mark", "View keyboard shortcuts"]);
    const titleStart = lines.findIndex((line) => !noise.has(line));
    const titleNode = document.querySelector('[data-testid="twitter-article-title"]');
    const title = (titleNode?.innerText || lines[titleStart] || '').trim();
    const author = lines[titleStart + 1] || '';
    const handle = lines[titleStart + 2] || '';
    const date = lines[titleStart + 4] === '·' ? lines[titleStart + 5] : (lines[titleStart + 4] || lines[titleStart + 3] || '');

    const richTextRoot = document.querySelector('[data-testid="twitterArticleRichTextView"]');
    const content =
      richTextRoot?.querySelector('[data-contents="true"]') ||
      richTextRoot?.querySelector('.DraftEditor-root [data-contents="true"]') ||
      Array.from(document.querySelectorAll('h2')).find((node) => node.innerText.includes('My Mental Model'))?.parentElement?.parentElement ||
      null;
    const children = content ? Array.from(content.children).map((child, index) => ({
      i: index,
      tag: child.tagName,
      className: child.className,
      text: (child.innerText || '').trim(),
      outerHTML: child.outerHTML,
      hrefs: Array.from(child.querySelectorAll('a[href]')).map((a) => a.href),
      hasArticle: !!child.querySelector('article'),
      hasMediaHref: Array.from(child.querySelectorAll('a[href]')).some((a) => a.href.includes('/media/')),
    })) : [];

    const allMediaHrefs = Array.from(document.querySelectorAll('a[href*="/media/"]')).map((a) => a.href);
    return JSON.stringify({
      title,
      author,
      handle,
      date,
      contentTag: content?.tagName || null,
      childCount: children.length,
      children,
      allMediaHrefs,
    });
  })()`);

  await fs.writeFile(path.join(logsDir, 'page-data-latest.json'), JSON.stringify(pageData, null, 2));

  const childMediaHrefs = pageData.children.flatMap((child) =>
    child.hrefs.filter((href) => href.includes('/media/'))
  );
  const heroMediaHref = pageData.allMediaHrefs.find((href) => !childMediaHrefs.includes(href)) || null;

  let heroImageUrl = null;
  let heroLocalPath = null;
  if (heroMediaHref) {
    const resolvedHero = await resolveArticleSectionImage(heroMediaHref);
    heroImageUrl = resolvedHero?.chosen || null;
    if (heroImageUrl) {
      heroLocalPath = path.join(assetsDir, 'hero.jpg');
      await downloadImage(heroImageUrl, heroLocalPath);
      const uploaded = await uploadAsset(heroLocalPath);
      heroLocalPath = uploaded || path.relative(baseDir, heroLocalPath).replace(/\\/g, '/');
    }
  }

  const sectionAssets = {};
  const tweetAssets = {};

  for (const child of pageData.children) {
    if (child.tag !== 'SECTION') continue;
    if (child.hasMediaHref) {
      const mediaHref = child.hrefs.find((href) => href.includes('/media/'));
      if (!mediaHref) continue;

      const resolved = await resolveArticleSectionImage(mediaHref);
      await fs.writeFile(
        path.join(logsDir, `block-${String(child.i).padStart(2, '0')}.json`),
        JSON.stringify({ kind: 'article-media', childIndex: child.i, mediaHref, resolved }, null, 2)
      );

      if (!resolved?.chosen) continue;

      const ext = path.extname(new URL(resolved.chosen).pathname) || '.jpg';
      const localPath = path.join(assetsDir, `article-${String(child.i).padStart(2, '0')}${ext}`);
      await downloadImage(resolved.chosen, localPath);
      const uploaded = await uploadAsset(localPath);
      sectionAssets[child.i] = {
        url: resolved.chosen,
        path: uploaded || path.relative(baseDir, localPath).replace(/\\/g, '/'),
        slide: resolved.slide,
      };
      continue;
    }

    if (child.hasArticle) {
      const statusUrl = child.hrefs.find((href) => /\/status\//.test(href));
      const screenshotPath = path.join(assetsDir, `tweetcard-${String(child.i).padStart(2, '0')}.png`);

      try {
        const captureArgs = [
          path.resolve('scripts/x-article/capture-article-element.mjs'),
          '--target', targetId,
          '--output', screenshotPath,
          '--child-index', String(child.i),
        ];
        if (statusUrl) captureArgs.push('--status-url', statusUrl);

        const capture = safeParse(await runNode(captureArgs[0], captureArgs.slice(1)));
        const uploaded = await uploadAsset(screenshotPath);
        const imagePath = uploaded || path.relative(baseDir, screenshotPath).replace(/\\/g, '/');
        tweetAssets[child.i] = {
          statusUrl,
          image: {
            path: imagePath,
            localPath: screenshotPath,
            meta: capture,
          },
        };
        await fs.writeFile(
          path.join(logsDir, `block-${String(child.i).padStart(2, '0')}.json`),
          JSON.stringify({ kind: 'tweet-screenshot', childIndex: child.i, statusUrl, capture }, null, 2)
        );
      } catch (error) {
        await fs.writeFile(
          path.join(logsDir, `block-${String(child.i).padStart(2, '0')}.json`),
          JSON.stringify({ kind: 'tweet-screenshot', childIndex: child.i, statusUrl, error: error.message }, null, 2)
        );
      }
    }
  }

  const parts = [];
  if (heroLocalPath) {
    parts.push(`![Hero image](${heroLocalPath})`);
  }

  for (const child of pageData.children) {
    if (child.tag === 'SECTION') {
      if (child.hasArticle) {
        const entry = tweetAssets[child.i];
        const statusUrl = child.hrefs.find((href) => /\/status\//.test(href)) || entry?.statusUrl;
        if (entry?.image?.path) {
          parts.push(`![Embedded post](${entry.image.path})`);
        } else {
          const lines = child.text.split('\n').map((line) => line.trim()).filter(Boolean);
          const body = lines.filter((line) => !/^[0-9.]+[KM]?$/.test(line));
          parts.push(body.map((line) => `> ${line}`).join('\n'));
        }
        if (statusUrl) parts.push(`> Source: ${statusUrl}`);
        continue;
      }
      if (child.hasMediaHref && sectionAssets[child.i]) {
        parts.push(`![Article image](${sectionAssets[child.i].path})`);
        const caption = child.text.trim();
        if (caption) parts.push(`> ${caption.replace(/\n+/g, ' ')}`);
        continue;
      }
      continue;
    }

    const md = cleanMarkdown(turndown.turndown(normalizeHtmlForTurndown(child.outerHTML)));
    if (!md) continue;
    parts.push(md);
  }

  const title = pageData.title || 'x-article';
  const markdown = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `author: ${JSON.stringify(pageData.author)}`,
    `handle: ${JSON.stringify(pageData.handle)}`,
    `source: ${JSON.stringify(articleUrl)}`,
    `date: ${JSON.stringify(pageData.date)}`,
    `downloaded_at: ${JSON.stringify(new Date().toISOString())}`,
    '---',
    '',
    `# ${title}`,
    '',
    `> Original: ${articleUrl}`,
    `> Author: ${pageData.author} (${pageData.handle})`,
    `> Published: ${pageData.date}`,
    '',
    parts.filter(Boolean).join('\n\n'),
    '',
  ].join('\n');

  const finalOutputPath = outputPath
    ? path.resolve(outputPath)
    : path.join(baseDir, `${fileSafeName(title)}.md`);

  await fs.writeFile(finalOutputPath, markdown);

  const verify = {
    markdown: finalOutputPath,
    heroImageUrl,
    heroAsset: heroLocalPath,
    sectionAssets: Object.keys(sectionAssets).length,
    tweetAssets: Object.keys(tweetAssets).length,
  };
  await fs.writeFile(path.join(logsDir, 'export-result.json'), JSON.stringify(verify, null, 2));
  console.log(finalOutputPath);
} finally {
  await closeTarget(targetId);
}
