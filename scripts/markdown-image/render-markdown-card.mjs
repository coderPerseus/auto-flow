#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
import { chromium } from 'playwright';
import sharp from 'sharp';

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    width: 1200,
    height: 1600,
    cssFile: null,
    title: null,
    watermarkText: null,
    watermarkImage: null,
    watermarkOpacity: 0.16,
    keepFrontmatter: false,
    htmlOutput: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      args.input = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      args.output = argv[++i];
    } else if (arg === '--width' && argv[i + 1]) {
      args.width = Number(argv[++i]);
    } else if (arg === '--height' && argv[i + 1]) {
      args.height = Number(argv[++i]);
    } else if (arg === '--css-file' && argv[i + 1]) {
      args.cssFile = argv[++i];
    } else if (arg === '--title' && argv[i + 1]) {
      args.title = argv[++i];
    } else if (arg === '--watermark-text' && argv[i + 1]) {
      args.watermarkText = argv[++i];
    } else if (arg === '--watermark-image' && argv[i + 1]) {
      args.watermarkImage = argv[++i];
    } else if (arg === '--watermark-opacity' && argv[i + 1]) {
      args.watermarkOpacity = Number(argv[++i]);
    } else if (arg === '--html-output' && argv[i + 1]) {
      args.htmlOutput = argv[++i];
    } else if (arg === '--keep-frontmatter') {
      args.keepFrontmatter = true;
    }
  }

  if (!args.input || !args.output) {
    throw new Error('用法: node scripts/markdown-image/render-markdown-card.mjs --input <markdown> --output <image> [--title <title>] [--css-file <css>] [--watermark-text <text>] [--watermark-image <path>] [--width 1200] [--height 1600] [--html-output <path>] [--keep-frontmatter]');
  }

  if (!Number.isFinite(args.width) || !Number.isFinite(args.height) || args.width <= 0 || args.height <= 0) {
    throw new Error('宽高必须是正整数');
  }

  if (!Number.isFinite(args.watermarkOpacity) || args.watermarkOpacity < 0 || args.watermarkOpacity > 1) {
    throw new Error('watermark-opacity 必须在 0 到 1 之间');
  }

  return args;
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return markdown;
  return markdown.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

function extractTitle(markdown, fallback) {
  const match = markdown.match(/^\s*#\s+(.+)$/m);
  if (match?.[1]) return match[1].trim();
  return fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildHtml({ title, renderedHtml, cssText, width, height }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        --card-width: ${width}px;
        --card-height: ${height}px;
      }
      ${cssText}
    </style>
  </head>
  <body>
    <main id="card" class="card">
      <div class="card__grain"></div>
      <header class="card__header">
        <p class="card__eyebrow">Markdown Poster</p>
        <h1 class="card__title">${escapeHtml(title)}</h1>
      </header>
      <section class="card__copy">
        <article class="card__copy-inner markdown-body">
          ${renderedHtml}
        </article>
      </section>
    </main>
  </body>
</html>`;
}

async function fitContent(page) {
  return page.evaluate(() => {
    const outer = document.querySelector('.card__copy');
    const inner = document.querySelector('.card__copy-inner');
    if (!outer || !inner) return 1;

    const fits = () =>
      outer.scrollHeight <= outer.clientHeight + 2 &&
      outer.scrollWidth <= outer.clientWidth + 2;

    let scale = 1;
    inner.style.zoom = String(scale);
    if (fits()) return scale;

    for (scale = 0.98; scale >= 0.66; scale -= 0.02) {
      inner.style.zoom = scale.toFixed(2);
      if (fits()) return Number(scale.toFixed(2));
    }

    inner.style.zoom = '0.66';
    return 0.66;
  });
}

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

async function createWatermarkOverlay({ width, height, text, imagePath, opacity }) {
  if (!text && !imagePath) return null;

  const overlayWidth = Math.round(width * 0.42);
  const imageHeight = imagePath ? Math.max(72, Math.round(height * 0.07)) : 0;
  const textHeight = text ? Math.max(48, Math.round(height * 0.06)) : 0;
  const overlayHeight = imageHeight + textHeight + 32;
  const imageY = 0;
  const textY = imageHeight ? imageHeight + 18 : Math.round(overlayHeight * 0.72);

  let imageMarkup = '';
  if (imagePath) {
    const imageBuffer = await fs.readFile(path.resolve(imagePath));
    const dataUri = `data:${mimeForFile(imagePath)};base64,${imageBuffer.toString('base64')}`;
    const imageWidth = Math.round(overlayWidth * 0.52);
    imageMarkup = `<image href="${dataUri}" x="${overlayWidth - imageWidth}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" opacity="${opacity}" preserveAspectRatio="xMaxYMid meet" />`;
  }

  const textMarkup = text
    ? `<text x="${overlayWidth}" y="${textY}" text-anchor="end" font-family="Arial, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="${Math.round(height * 0.026)}" font-weight="700" fill="rgba(15,23,42,${opacity})" transform="rotate(-8 ${overlayWidth - 8} ${textY})">${escapeXml(text)}</text>`
    : '';

  return Buffer.from(
    `<svg width="${overlayWidth}" height="${overlayHeight}" viewBox="0 0 ${overlayWidth} ${overlayHeight}" xmlns="http://www.w3.org/2000/svg">${imageMarkup}${textMarkup}</svg>`
  );
}

async function applyWatermark(outputPath, options) {
  if (!options.watermarkText && !options.watermarkImage) return;

  const resolvedOutput = path.resolve(outputPath);
  const baseBuffer = await fs.readFile(resolvedOutput);
  const metadata = await sharp(baseBuffer).metadata();
  const overlay = await createWatermarkOverlay({
    width: metadata.width,
    height: metadata.height,
    text: options.watermarkText,
    imagePath: options.watermarkImage,
    opacity: options.watermarkOpacity,
  });

  if (!overlay) return;

  const overlayMeta = await sharp(overlay).metadata();
  const margin = Math.round(metadata.width * 0.045);

  await sharp(baseBuffer)
    .composite([
      {
        input: overlay,
        left: metadata.width - overlayMeta.width - margin,
        top: metadata.height - overlayMeta.height - margin,
      },
    ])
    .toFile(resolvedOutput);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const defaultCssPath = path.resolve(scriptDir, '..', '..', 'references', 'markdown-card-theme.css');
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  const cssPath = args.cssFile ? path.resolve(args.cssFile) : defaultCssPath;

  let markdown = await fs.readFile(inputPath, 'utf8');
  if (!args.keepFrontmatter) {
    markdown = stripFrontmatter(markdown);
  }

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
    typographer: false,
  }).use(markdownItFootnote);

  const title = args.title || extractTitle(markdown, path.basename(inputPath, path.extname(inputPath)));
  const renderedHtml = md.render(markdown);
  const cssText = await fs.readFile(cssPath, 'utf8');
  const html = buildHtml({
    title,
    renderedHtml,
    cssText,
    width: args.width,
    height: args.height,
  });

  if (args.htmlOutput) {
    const htmlOutputPath = path.resolve(args.htmlOutput);
    await fs.mkdir(path.dirname(htmlOutputPath), { recursive: true });
    await fs.writeFile(htmlOutputPath, html);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: args.width,
        height: args.height,
      },
      deviceScaleFactor: 1,
    });

    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });
    await fitContent(page);

    const card = page.locator('#card');
    await card.screenshot({
      path: outputPath,
      type: path.extname(outputPath).toLowerCase() === '.jpg' || path.extname(outputPath).toLowerCase() === '.jpeg' ? 'jpeg' : 'png',
      quality: path.extname(outputPath).toLowerCase() === '.jpg' || path.extname(outputPath).toLowerCase() === '.jpeg' ? 92 : undefined,
    });
  } finally {
    await browser.close();
  }

  await applyWatermark(outputPath, args);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
