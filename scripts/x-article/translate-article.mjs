#!/usr/bin/env node
// 调用 DeepSeek / Gemini 翻译已导出的 Markdown 文章。
// 用法:
//   node translate-article.mjs --input ./article.md
//   node translate-article.mjs --input ./article.md --provider gemini --model gemini-2.5-pro
//   node translate-article.mjs --input ./article.md --prompt "翻译成日文，保留术语英文"

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  analyzeArticle,
  buildSystemPrompt,
  buildUserPrompt,
  detectTargetLanguageFromPrompt,
  ensureConfigInteractive,
  loadConfig,
  resolveApiKey,
  summarizeConfig,
} from './translation-common.mjs';

const args = process.argv.slice(2);
let inputPath = null;
let outputPath = null;
let provider = null;
let model = null;
let promptText = '';
let targetLanguage = '中文';
let dryRunPrompt = false;
let forceConfig = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--input' && args[i + 1]) {
    inputPath = args[++i];
  } else if (arg === '--output' && args[i + 1]) {
    outputPath = args[++i];
  } else if (arg === '--provider' && args[i + 1]) {
    provider = args[++i];
  } else if (arg === '--model' && args[i + 1]) {
    model = args[++i];
  } else if (arg === '--prompt' && args[i + 1]) {
    promptText = args[++i];
  } else if (arg === '--target-language' && args[i + 1]) {
    targetLanguage = args[++i];
  } else if (arg === '--dry-run-prompt') {
    dryRunPrompt = true;
  } else if (arg === '--force-config') {
    forceConfig = true;
  }
}

if (!inputPath) {
  console.error('用法: node translate-article.mjs --input <markdown-path> [--output <path>] [--provider <deepseek|gemini>] [--model <model-id>] [--prompt "..."] [--target-language 中文]');
  process.exit(1);
}

const absoluteInputPath = path.resolve(inputPath);
const markdown = await fs.readFile(absoluteInputPath, 'utf8');
const promptLanguage = detectTargetLanguageFromPrompt(promptText);
const finalTargetLanguage = promptLanguage || targetLanguage || '中文';

const existingConfig = await loadConfig();
const configured = await ensureConfigInteractive({
  provider: provider || existingConfig.default_provider,
  model: model || existingConfig.default_model,
  apiKey: provider ? resolveApiKey(provider, existingConfig) : null,
  force: forceConfig,
});

const analysis = analyzeArticle(markdown);
const systemPrompt = buildSystemPrompt({
  analysis,
  targetLanguage: finalTargetLanguage,
  userPrompt: promptText,
});
const userPrompt = buildUserPrompt({
  markdown,
  targetLanguage: finalTargetLanguage,
  userPrompt: promptText,
});

if (dryRunPrompt) {
  console.log(JSON.stringify({
    input: absoluteInputPath,
    provider: configured.provider,
    model: configured.model,
    target_language: finalTargetLanguage,
    analysis,
    config: summarizeConfig(configured.config),
    system_prompt: systemPrompt,
    user_prompt_preview: userPrompt.slice(0, 1500),
  }, null, 2));
  process.exit(0);
}

async function translateWithDeepSeek() {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${configured.apiKey}`,
    },
    body: JSON.stringify({
      model: configured.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DeepSeek 请求失败 (${res.status}): ${text}`);
  }
  const data = JSON.parse(text);
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('DeepSeek 返回为空');
  }
  return content;
}

async function translateWithGemini() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(configured.model)}:generateContent?key=${encodeURIComponent(configured.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini 请求失败 (${res.status}): ${text}`);
  }
  const data = JSON.parse(text);
  const content = data.candidates?.[0]?.content?.parts?.map((item) => item.text || '').join('').trim();
  if (!content) {
    throw new Error('Gemini 返回为空');
  }
  return content;
}

let translatedMarkdown;
if (configured.provider === 'deepseek') {
  translatedMarkdown = await translateWithDeepSeek();
} else if (configured.provider === 'gemini') {
  translatedMarkdown = await translateWithGemini();
} else {
  throw new Error(`不支持的 provider: ${configured.provider}`);
}

function languageSuffix(language) {
  const mapping = {
    中文: 'zh',
    英文: 'en',
    日文: 'ja',
    韩文: 'ko',
    法文: 'fr',
    德文: 'de',
    西班牙文: 'es',
    俄文: 'ru',
  };
  return mapping[language] || language.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

const finalOutputPath = outputPath
  ? path.resolve(outputPath)
  : absoluteInputPath.replace(/\.md$/i, `.${languageSuffix(finalTargetLanguage)}.md`);

await fs.writeFile(finalOutputPath, translatedMarkdown.endsWith('\n') ? translatedMarkdown : `${translatedMarkdown}\n`);

console.log(JSON.stringify({
  input: absoluteInputPath,
  output: finalOutputPath,
  provider: configured.provider,
  model: configured.model,
  target_language: finalTargetLanguage,
  analysis,
}, null, 2));
