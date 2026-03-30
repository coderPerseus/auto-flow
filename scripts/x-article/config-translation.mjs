#!/usr/bin/env node
// 配置 x-article 翻译偏好与 API key。
// 用法:
//   node config-translation.mjs
//   node config-translation.mjs --show
//   node config-translation.mjs --list-models [--provider deepseek|gemini]
//   node config-translation.mjs --provider deepseek --model deepseek-chat --api-key sk-xxx

import {
  PROVIDERS,
  ensureConfigInteractive,
  getProviderModels,
  loadConfig,
  summarizeConfig,
} from './translation-common.mjs';

const args = process.argv.slice(2);
let provider = null;
let model = null;
let apiKey = null;
let show = false;
let listModels = false;
let force = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--provider' && args[i + 1]) {
    provider = args[++i];
  } else if (arg === '--model' && args[i + 1]) {
    model = args[++i];
  } else if (arg === '--api-key' && args[i + 1]) {
    apiKey = args[++i];
  } else if (arg === '--show') {
    show = true;
  } else if (arg === '--list-models') {
    listModels = true;
  } else if (arg === '--force') {
    force = true;
  }
}

if (listModels) {
  const result = provider
    ? {
        provider,
        models: getProviderModels(provider),
      }
    : Object.fromEntries(
        Object.values(PROVIDERS).map((item) => [item.id, item.models])
      );
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (show) {
  const config = await loadConfig();
  console.log(JSON.stringify(summarizeConfig(config), null, 2));
  process.exit(0);
}

const configured = await ensureConfigInteractive({
  provider,
  model,
  apiKey,
  force,
});

console.log(JSON.stringify({
  provider: configured.provider,
  model: configured.model,
  config_file: summarizeConfig(configured.config).config_file,
  api_keys: summarizeConfig(configured.config).api_keys,
}, null, 2));
