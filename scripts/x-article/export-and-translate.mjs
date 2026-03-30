#!/usr/bin/env node
// 串联 X Article 导出与翻译。
// 用法:
//   node export-and-translate.mjs <x-article-url>
//   node export-and-translate.mjs <x-article-url> --provider gemini --model gemini-3-flash-preview

import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);

let articleUrl = null;
let outputPath = null;
let translatedOutputPath = null;
let picgoConfig = null;
let provider = null;
let model = null;
let targetLanguage = null;
let translationPrompt = null;
let workflowName = 'x-article-translate';
let dryRunPrompt = false;
let forceConfig = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!articleUrl && !arg.startsWith('--')) {
    articleUrl = arg;
  } else if (arg === '--output' && args[i + 1]) {
    outputPath = args[++i];
  } else if (arg === '--translated-output' && args[i + 1]) {
    translatedOutputPath = args[++i];
  } else if (arg === '--picgo-config' && args[i + 1]) {
    picgoConfig = args[++i];
  } else if (arg === '--provider' && args[i + 1]) {
    provider = args[++i];
  } else if (arg === '--model' && args[i + 1]) {
    model = args[++i];
  } else if (arg === '--target-language' && args[i + 1]) {
    targetLanguage = args[++i];
  } else if (arg === '--translation-prompt' && args[i + 1]) {
    translationPrompt = args[++i];
  } else if (arg === '--workflow-name' && args[i + 1]) {
    workflowName = args[++i];
  } else if (arg === '--dry-run-prompt') {
    dryRunPrompt = true;
  } else if (arg === '--force-config') {
    forceConfig = true;
  }
}

if (!articleUrl) {
  console.error('用法: node export-and-translate.mjs <x-article-url> [--output <markdown-path>] [--translated-output <path>] [--provider <deepseek|gemini>] [--model <model-id>] [--target-language 中文] [--translation-prompt "..."] [--dry-run-prompt]');
  process.exit(1);
}

const cwd = process.cwd();

async function runNode(scriptRelativePath, scriptArgs) {
  const scriptPath = path.resolve(scriptRelativePath);
  const { stdout } = await execFileAsync('node', [scriptPath, ...scriptArgs], { cwd });
  return stdout.trim();
}

async function ensureProxyReady() {
  try {
    const res = await fetch('http://127.0.0.1:3456/health');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    throw new Error('CDP Proxy 未就绪，请先启动 `node scripts/cdp-proxy.mjs` 或运行 `bash scripts/check-deps.sh`。');
  }
}

await ensureProxyReady();

const exportArgs = [articleUrl];
if (outputPath) exportArgs.push('--output', outputPath);
if (picgoConfig) exportArgs.push('--picgo-config', picgoConfig);
if (workflowName) exportArgs.push('--workflow-name', workflowName);

const exportStdout = await runNode('scripts/x-article/export-article-markdown.mjs', exportArgs);
const markdownPath = exportStdout.split('\n').filter(Boolean).at(-1);

if (!markdownPath) {
  throw new Error('导出 Markdown 失败：未返回 Markdown 路径');
}

const translateArgs = ['--input', markdownPath];
if (translatedOutputPath) translateArgs.push('--output', translatedOutputPath);
if (provider) translateArgs.push('--provider', provider);
if (model) translateArgs.push('--model', model);
if (targetLanguage) translateArgs.push('--target-language', targetLanguage);
if (translationPrompt) translateArgs.push('--prompt', translationPrompt);
if (dryRunPrompt) translateArgs.push('--dry-run-prompt');
if (forceConfig) translateArgs.push('--force-config');

const translateStdout = await runNode('scripts/x-article/translate-article.mjs', translateArgs);
const translateResult = JSON.parse(translateStdout);

console.log(JSON.stringify({
  markdown: markdownPath,
  translated_markdown: translateResult.output || null,
  provider: translateResult.provider,
  model: translateResult.model,
  target_language: translateResult.target_language,
  analysis: translateResult.analysis,
  system_prompt: translateResult.system_prompt || undefined,
}, null, 2));
