#!/usr/bin/env node
// 下载图片到本地临时目录
// 用法: node download-image.mjs <url> [--output <path>]
// 输出: 下载后的本地文件路径

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
let imageUrl = null;
let outputPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) {
    outputPath = args[++i];
  } else if (!imageUrl) {
    imageUrl = args[i];
  }
}

if (!imageUrl) {
  console.error('用法: node download-image.mjs <url> [--output <path>]');
  process.exit(1);
}

function getExtFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).split('?')[0];
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp'].includes(ext.toLowerCase())) {
      return ext;
    }
  } catch {}
  return '.png'; // 默认
}

function getExtFromContentType(contentType) {
  if (!contentType) return null;
  const map = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/avif': '.avif',
  };
  return map[contentType.split(';')[0].trim()] || null;
}

async function download(url, maxRedirects = 5) {
  if (maxRedirects <= 0) throw new Error('重定向次数过多');

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).href;
        resolve(download(redirectUrl, maxRedirects - 1));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'];

        // 确定输出路径 - 使用随机文件名避免覆盖
        if (!outputPath) {
          const ext = getExtFromContentType(contentType) || getExtFromUrl(url);
          const rand = crypto.randomBytes(8).toString('hex');
          const tmpDir = path.join(os.tmpdir(), 'x-article-images');
          fs.mkdirSync(tmpDir, { recursive: true });
          outputPath = path.join(tmpDir, `${rand}${ext}`);
        }

        fs.writeFileSync(outputPath, buffer);
        resolve(outputPath);
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

try {
  const result = await download(imageUrl);
  console.log(result);
} catch (e) {
  console.error(`下载失败: ${e.message}`);
  process.exit(1);
}
