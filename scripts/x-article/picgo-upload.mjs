#!/usr/bin/env node
// PicGo 图片上传工具
// 读取 PicGo 配置，通过 PicGo Server 或直接上传到图床
// 用法: node picgo-upload.mjs <file-path> [--picgo-config <path>]
// 输出: 上传后的图片 URL

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

// --- 解析命令行参数 ---
const args = process.argv.slice(2);
let filePath = null;
let customConfigPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--picgo-config' && args[i + 1]) {
    customConfigPath = args[++i];
  } else if (!filePath) {
    filePath = args[i];
  }
}

if (!filePath) {
  console.error('用法: node picgo-upload.mjs <file-path> [--picgo-config <config-path>]');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`文件不存在: ${filePath}`);
  process.exit(1);
}

// --- 查找 PicGo 配置 ---
function findPicGoConfig() {
  if (customConfigPath) {
    if (fs.existsSync(customConfigPath)) return customConfigPath;
    console.error(`指定的 PicGo 配置不存在: ${customConfigPath}`);
    process.exit(1);
  }

  const home = os.homedir();
  const platform = os.platform();

  // 按优先级搜索配置路径
  const candidates = [];

  if (platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library/Application Support', 'picgo', 'data.json'),
      path.join(home, 'Library/Application Support', 'picgo', 'data.bak.json'),
      path.join(home, '.picgo', 'config.json'),
      path.join(home, 'Library/Application Support/picgo', 'config.json'),
    );
  } else if (platform === 'win32') {
    candidates.push(
      path.join(home, 'AppData', 'Roaming', 'picgo', 'data.json'),
      path.join(home, 'AppData', 'Roaming', 'picgo', 'data.bak.json'),
      path.join(home, '.picgo', 'config.json'),
      path.join(home, 'AppData', 'Roaming', 'picgo', 'config.json'),
    );
  } else {
    // Linux
    candidates.push(
      path.join(home, '.config', 'picgo', 'data.json'),
      path.join(home, '.config', 'picgo', 'data.bak.json'),
      path.join(home, '.picgo', 'config.json'),
      path.join(home, '.config', 'picgo', 'config.json'),
    );
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.error(`[picgo] 使用配置: ${p}`);
      return p;
    }
  }

  console.error('[picgo] 未找到 PicGo 配置文件，尝试以下位置:');
  candidates.forEach(c => console.error(`  - ${c}`));
  process.exit(1);
}

const configPath = findPicGoConfig();
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const currentUploader = config.picBed?.current || 'smms';
const uploaderConfig = config.picBed?.[currentUploader] || {};
const serverConfig = config.settings?.server || {};

console.error(`[picgo] 当前图床: ${currentUploader}`);

// --- 生成随机文件名（保留扩展名）---
function randomFileName(file) {
  const ext = path.extname(file);
  const rand = crypto.randomBytes(8).toString('hex');
  return `${rand}${ext}`;
}

// --- 复制文件到临时随机文件名 ---
function copyToRandomName(file) {
  const tmpDir = path.join(os.tmpdir(), 'picgo-upload');
  fs.mkdirSync(tmpDir, { recursive: true });
  const dest = path.join(tmpDir, randomFileName(file));
  fs.copyFileSync(file, dest);
  return dest;
}

// --- PicGo Server 上传 (优先) ---
async function uploadViaPicGoServer(file) {
  const port = serverConfig.port || 36677;
  const host = serverConfig.host || '127.0.0.1';

  // 复制到随机文件名，避免图床覆盖同名文件
  const randomFile = copyToRandomName(file);

  return new Promise((resolve, reject) => {
    const checkReq = http.request({ host, port, path: '/upload', method: 'POST', timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // 清理临时文件
        try { fs.unlinkSync(randomFile); } catch {}
        try {
          const result = JSON.parse(data);
          if (result.success && result.result?.length > 0) {
            resolve(result.result[0]);
          } else {
            reject(new Error(`PicGo Server 上传失败: ${data}`));
          }
        } catch (e) {
          reject(new Error(`PicGo Server 响应解析失败: ${data}`));
        }
      });
    });

    checkReq.on('error', () => { try { fs.unlinkSync(randomFile); } catch {} reject(new Error('PicGo Server 未运行')); });
    checkReq.on('timeout', () => { checkReq.destroy(); try { fs.unlinkSync(randomFile); } catch {} reject(new Error('PicGo Server 超时')); });

    const body = JSON.stringify({ list: [randomFile] });
    checkReq.setHeader('Content-Type', 'application/json');
    checkReq.setHeader('Content-Length', Buffer.byteLength(body));
    checkReq.end(body);
  });
}

// --- Cloudflare R2 直接上传 (S3 兼容) ---
async function uploadToR2(file) {
  const { endpoint, accessKeyId, secretAccessKey, bucketName, subFolder, domain } = uploaderConfig;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('R2 配置不完整，需要 endpoint, accessKeyId, secretAccessKey, bucketName');
  }

  const fileBuffer = fs.readFileSync(file);
  const ext = path.extname(file);
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const objectKey = `${subFolder || ''}${timestamp}_${randomSuffix}${ext}`;

  // S3 Signature V4
  const url = new URL(`${endpoint}/${bucketName}/${objectKey}`);
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const region = 'auto';
  const service = 's3';

  const contentType = getMimeType(ext);
  const payloadHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // Canonical request
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${url.hostname}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join('\n') + '\n';

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    `/${bucketName}/${objectKey}`,
    '', // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // String to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  // Signing key
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: `/${bucketName}/${objectKey}`,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        'Authorization': authHeader,
      },
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const publicUrl = domain ? `${domain}/${objectKey}` : `${endpoint}/${bucketName}/${objectKey}`;
          resolve(publicUrl);
        } else {
          reject(new Error(`R2 上传失败 (${res.statusCode}): ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end(fileBuffer);
  });
}

// --- 腾讯云 COS 上传 ---
async function uploadToTcyun(file) {
  const { secretId, secretKey, bucket, area, path: cosPath } = uploaderConfig;

  if (!secretId || !secretKey || !bucket || !area) {
    throw new Error('腾讯云 COS 配置不完整');
  }

  const fileBuffer = fs.readFileSync(file);
  const ext = path.extname(file);
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const objectKey = `${cosPath || ''}${timestamp}_${randomSuffix}${ext}`;
  const hostname = `${bucket}.cos.${area}.myqcloud.com`;

  // COS 签名
  const now = Math.floor(Date.now() / 1000);
  const signTime = `${now - 60};${now + 3600}`;

  const httpString = `put\n/${objectKey}\n\nhost=${hostname}\n`;
  const sha1HttpString = crypto.createHash('sha1').update(httpString).digest('hex');
  const stringToSign = `sha1\n${signTime}\n${sha1HttpString}\n`;

  const signKey = crypto.createHmac('sha1', secretKey).update(signTime).digest('hex');
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');

  const auth = [
    `q-sign-algorithm=sha1`,
    `q-ak=${secretId}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${signTime}`,
    `q-header-list=host`,
    `q-url-param-list=`,
    `q-signature=${signature}`,
  ].join('&');

  const contentType = getMimeType(ext);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path: `/${objectKey}`,
      method: 'PUT',
      headers: {
        'Host': hostname,
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length,
        'Authorization': auth,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(`https://${hostname}/${objectKey}`);
        } else {
          reject(new Error(`COS 上传失败 (${res.statusCode}): ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end(fileBuffer);
  });
}

function getMimeType(ext) {
  const types = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}

// --- 主流程 ---
async function main() {
  let url;

  // 1. 尝试 PicGo Server
  if (serverConfig.enable !== false) {
    try {
      url = await uploadViaPicGoServer(filePath);
      console.log(url);
      return;
    } catch (e) {
      console.error(`[picgo] Server 不可用: ${e.message}，尝试直接上传...`);
    }
  }

  // 2. 直接上传
  try {
    if (currentUploader === 'cloudflare-r2') {
      url = await uploadToR2(filePath);
    } else if (currentUploader === 'tcyun') {
      url = await uploadToTcyun(filePath);
    } else {
      console.error(`[picgo] 不支持的图床直接上传: ${currentUploader}，请启动 PicGo Server`);
      process.exit(1);
    }
    console.log(url);
  } catch (e) {
    console.error(`[picgo] 上传失败: ${e.message}`);
    process.exit(1);
  }
}

main();
