#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);

let articleUrl = null;
let outputPath = null;
let picgoConfig = null;
let workflowName = 'article-export-markdown';

for (let i = 0; i < args.length; i += 1) {
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
  console.error('用法: node scripts/article-export/export-article-markdown.mjs <url> [--output <path>] [--picgo-config <path>] [--workflow-name <name>]');
  process.exit(1);
}

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

function normalizeText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanMarkdown(text) {
  return String(text || '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function fileSafeName(name) {
  return normalizeText(name).replace(/[\\/:*?"<>|]/g, ' ');
}

function stripLeadingTitle(markdown, title) {
  const lines = String(markdown || '').split('\n');
  const normalizedTitle = normalizeText(title).toLowerCase();
  if (lines[0]?.startsWith('# ')) {
    const heading = normalizeText(lines[0].slice(2)).toLowerCase();
    if (heading === normalizedTitle) {
      return lines.slice(1).join('\n').trim();
    }
  }
  return markdown;
}

function isLikelyDate(text) {
  const value = normalizeText(text);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    || /^[A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4}$/.test(value)
    || /^\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}$/.test(value);
}

function toAbsoluteUrl(value, baseUrl) {
  if (!value || value.startsWith('data:') || value.startsWith('mailto:') || value.startsWith('javascript:') || value.startsWith('#')) {
    return value;
  }
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

function pickFromSrcset(value, baseUrl) {
  const candidates = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [urlPart, descriptor = ''] = item.split(/\s+/, 2);
      const score = descriptor.endsWith('w')
        ? Number.parseInt(descriptor, 10)
        : descriptor.endsWith('x')
          ? Number.parseFloat(descriptor) * 1000
          : 0;
      return { url: toAbsoluteUrl(urlPart, baseUrl), score: Number.isFinite(score) ? score : 0 };
    })
    .filter((item) => item.url);

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || null;
}

function pickImageUrl(img, baseUrl) {
  const srcset = img.attr('srcset') || img.attr('data-srcset');
  const bestFromSrcset = pickFromSrcset(srcset, baseUrl);
  if (bestFromSrcset) return bestFromSrcset;

  const direct = img.attr('src') || img.attr('data-src') || img.attr('data-original');
  return toAbsoluteUrl(direct, baseUrl);
}

function buildTurndown() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });

  turndown.remove(['style', 'script', 'noscript', 'button', 'svg']);

  turndown.addRule('figure', {
    filter(node) {
      return node.nodeName === 'FIGURE';
    },
    replacement(_, node) {
      const img = node.querySelector('img');
      if (!img) return '\n\n';
      const src = img.getAttribute('src') || '';
      const alt = normalizeText(img.getAttribute('alt')) || 'Image';
      const caption = normalizeText(node.querySelector('figcaption')?.textContent || '');
      const parts = [`![${alt}](${src})`];
      if (caption) parts.push(`> ${caption}`);
      return `\n\n${parts.join('\n\n')}\n\n`;
    },
  });

  turndown.addRule('images', {
    filter(node) {
      return node.nodeName === 'IMG';
    },
    replacement(_, node) {
      const src = node.getAttribute('src') || '';
      if (!src) return '';
      const alt = normalizeText(node.getAttribute('alt')) || 'Image';
      return `![${alt}](${src})`;
    },
  });

  turndown.addRule('tables', {
    filter(node) {
      return node.nodeName === 'TABLE';
    },
    replacement(_, node) {
      const rows = Array.from(node.querySelectorAll('tr'))
        .map((row) => Array.from(row.querySelectorAll('th,td')).map((cell) => normalizeText(cell.textContent).replace(/\|/g, '\\|')))
        .filter((row) => row.length > 0);

      if (rows.length === 0) return '\n\n';

      const header = rows[0];
      const body = rows.slice(1);
      const lines = [
        `| ${header.join(' | ')} |`,
        `| ${header.map(() => '---').join(' | ')} |`,
        ...body.map((row) => `| ${row.join(' | ')} |`),
      ];
      return `\n\n${lines.join('\n')}\n\n`;
    },
  });

  return turndown;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`抓取失败: HTTP ${res.status}`);
  }

  return {
    html: await res.text(),
    finalUrl: res.url || url,
  };
}

function pickContentRoot($) {
  const orderedCandidates = [
    'article',
    'main article',
    'main',
    '[role="main"]',
    '.post-content',
    '.entry-content',
    '.article-content',
    '.post-body',
    '.article-body',
    '.content',
  ];

  let best = null;
  const seen = new Set();

  for (const selector of orderedCandidates) {
    $(selector).each((_, element) => {
      if (seen.has(element)) return;
      seen.add(element);

      const node = $(element);
      const textLength = normalizeText(node.text()).length;
      const paragraphCount = node.find('p').length;
      const headingCount = node.find('h1,h2,h3').length;
      const imageCount = node.find('img').length;
      const score = textLength + paragraphCount * 120 + headingCount * 160 + imageCount * 80;

      if (!best || score > best.score) {
        best = { node, score };
      }
    });
  }

  if (best?.score > 300) return best.node;
  return $('body').first();
}

function extractMetadata($, root, pageUrl) {
  const title = normalizeText(
    $('meta[property="og:title"]').attr('content')
    || $('meta[name="twitter:title"]').attr('content')
    || $('title').text()
    || root.find('h1').first().text()
  ) || 'article';

  const author = normalizeText(
    $('meta[name="author"]').attr('content')
    || $('meta[property="article:author"]').attr('content')
    || root.find('[rel="author"]').first().text()
    || root.find('.author,.byline,[class*="author"]').first().text()
  );

  const date = normalizeText(
    $('meta[property="article:published_time"]').attr('content')
    || $('meta[name="date"]').attr('content')
    || root.find('time').first().attr('datetime')
    || root.find('time').first().text()
    || root.find('p,div,span').filter((_, element) => isLikelyDate($(element).text())).first().text()
  );

  const description = normalizeText(
    $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content')
  );

  return {
    title,
    author,
    date,
    description,
    source: pageUrl,
  };
}

function cleanupContent($, root, metadata) {
  root.find('script,style,noscript,iframe,template,nav,aside,form,button').remove();
  root.find('.toc,.table-of-contents,.toc-header,[aria-label*="table of contents" i]').remove();
  root.find('[class*="share"],[class*="social"],[class*="newsletter"],[class*="subscribe"],[class*="comment"]').remove();

  root.find('*').each((_, element) => {
    const node = $(element);
    const text = normalizeText(node.text());
    if (!text) return;

    if (/^This page respects your privacy\b/i.test(text)) {
      node.remove();
    }
  });

  const firstHeading = root.find('h1').first();
  if (firstHeading.length && normalizeText(firstHeading.text()).toLowerCase() === normalizeText(metadata.title).toLowerCase()) {
    const next = firstHeading.next();
    firstHeading.remove();
    if (next.length && isLikelyDate(next.text())) {
      next.remove();
    }
  }

  root.find('a[href]').each((_, element) => {
    const node = $(element);
    const href = node.attr('href');
    const absoluteHref = toAbsoluteUrl(href, metadata.source);
    if (absoluteHref) node.attr('href', absoluteHref);
  });
}

async function runNode(scriptPath, scriptArgs) {
  const { stdout } = await execFileAsync('node', [scriptPath, ...scriptArgs], { cwd });
  return stdout.trim();
}

async function downloadImage(url, localPath) {
  await runNode(path.resolve('scripts/x-article/download-image.mjs'), [url, '--output', localPath]);
}

async function uploadAsset(localPath) {
  try {
    const scriptArgs = [localPath];
    if (picgoConfig) scriptArgs.push('--picgo-config', picgoConfig);
    const stdout = await runNode(path.resolve('scripts/x-article/picgo-upload.mjs'), scriptArgs);
    return stdout.split('\n').filter(Boolean).at(-1) || null;
  } catch {
    return null;
  }
}

async function processImages($, root, baseUrl) {
  const seen = new Map();
  const images = [];
  let index = 0;

  for (const element of root.find('img').toArray()) {
    const node = $(element);
    const originalUrl = pickImageUrl(node, baseUrl);
    if (!originalUrl || originalUrl.startsWith('data:')) continue;

    let finalUrl = seen.get(originalUrl);
    let localPath = null;

    if (!finalUrl) {
      index += 1;
      const ext = path.extname(new URL(originalUrl).pathname) || '.png';
      localPath = path.join(downloadsDir, `image-${String(index).padStart(2, '0')}${ext}`);
      await downloadImage(originalUrl, localPath);
      const uploaded = await uploadAsset(localPath);
      finalUrl = uploaded || path.relative(baseDir, localPath).replace(/\\/g, '/');
      seen.set(originalUrl, finalUrl);
    }

    node.attr('src', finalUrl);
    node.removeAttr('srcset');
    node.removeAttr('data-src');
    node.removeAttr('data-srcset');

    images.push({
      originalUrl,
      outputUrl: finalUrl,
      localPath,
      alt: normalizeText(node.attr('alt')),
    });
  }

  return images;
}

const { html, finalUrl } = await fetchHtml(articleUrl);
const $ = cheerio.load(html);
const root = pickContentRoot($).clone();
const metadata = extractMetadata($, root, finalUrl);

cleanupContent($, root, metadata);
const images = await processImages($, root, finalUrl);

const turndown = buildTurndown();
let markdownBody = cleanMarkdown(stripLeadingTitle(turndown.turndown(root.html() || ''), metadata.title));

if (!markdownBody) {
  throw new Error('未提取到正文内容');
}

const finalOutputPath = outputPath
  ? path.resolve(outputPath)
  : path.join(baseDir, `${fileSafeName(metadata.title)}.md`);

const headerLines = [
  '---',
  `title: ${JSON.stringify(metadata.title)}`,
  `author: ${JSON.stringify(metadata.author || '')}`,
  `source: ${JSON.stringify(metadata.source)}`,
  `date: ${JSON.stringify(metadata.date || '')}`,
  `description: ${JSON.stringify(metadata.description || '')}`,
  `downloaded_at: ${JSON.stringify(new Date().toISOString())}`,
  '---',
  '',
  `# ${metadata.title}`,
  '',
  `> Original: ${metadata.source}`,
  metadata.author ? `> Author: ${metadata.author}` : null,
  metadata.date ? `> Published: ${metadata.date}` : null,
  '',
].filter(Boolean);

const markdown = `${headerLines.join('\n')}\n${markdownBody}\n`;

await fs.writeFile(finalOutputPath, markdown);
await fs.writeFile(
  path.join(logsDir, 'export-result.json'),
  JSON.stringify(
    {
      output: finalOutputPath,
      metadata,
      imageCount: images.length,
      images,
    },
    null,
    2
  )
);

console.log(finalOutputPath);
