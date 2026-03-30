import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const PROVIDERS = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: [
      {
        id: 'deepseek-chat',
        label: 'deepseek-chat',
        description: '当前主力通用文本模型，对应 DeepSeek-V3.2 非思考模式，适合高质量翻译。',
        updatedAt: '2025-12-01',
        source: 'https://api-docs.deepseek.com/updates/',
      },
      {
        id: 'deepseek-reasoner',
        label: 'deepseek-reasoner',
        description: '当前主力推理模型，对应 DeepSeek-V3.2 思考模式，适合更重的术语和复杂上下文。',
        updatedAt: '2025-12-01',
        source: 'https://api-docs.deepseek.com/updates/',
      },
    ],
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    models: [
      {
        id: 'gemini-3.1-pro-preview',
        label: 'gemini-3.1-pro-preview',
        description: 'Gemini 当前最新高阶预览模型，偏复杂技术长文与高质量翻译。',
        updatedAt: '2026-03-18',
        source: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview',
      },
      {
        id: 'gemini-3-flash-preview',
        label: 'gemini-3-flash-preview',
        description: 'Gemini 当前前沿高性能预览模型，适合兼顾质量与速度。',
        updatedAt: '2026-03-18',
        source: 'https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview',
      },
      {
        id: 'gemini-3.1-flash-lite-preview',
        label: 'gemini-3.1-flash-lite-preview',
        description: 'Gemini 当前最新轻量预览模型，官方明确适合高频翻译任务。',
        updatedAt: '2026-03-18',
        source: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview',
      },
      {
        id: 'gemini-2.5-pro',
        label: 'gemini-2.5-pro',
        description: 'Gemini 当前稳定高质量思考模型，适合长文和技术翻译。',
        updatedAt: '2026-02-18',
        source: 'https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro',
      },
      {
        id: 'gemini-2.5-flash',
        label: 'gemini-2.5-flash',
        description: 'Gemini 当前稳定高性价比模型，适合日常翻译。',
        updatedAt: '2026-02-18',
        source: 'https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash',
      },
    ],
  },
};

const DEFAULT_CONFIG = {
  default_provider: 'deepseek',
  default_model: 'deepseek-chat',
  api_keys: {},
  updated_at: null,
};

export function getConfigDir() {
  return process.env.X_ARTICLE_TRANSLATE_CONFIG_DIR || path.join(os.homedir(), '.config', 'x-article-translate');
}

export function getConfigFile() {
  return path.join(getConfigDir(), 'config.json');
}

export async function loadConfig() {
  try {
    const raw = await fs.readFile(getConfigFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      api_keys: {
        ...DEFAULT_CONFIG.api_keys,
        ...(parsed.api_keys || {}),
      },
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }
}

export async function saveConfig(config) {
  const next = {
    ...DEFAULT_CONFIG,
    ...config,
    api_keys: {
      ...DEFAULT_CONFIG.api_keys,
      ...(config.api_keys || {}),
    },
    updated_at: new Date().toISOString(),
  };
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(getConfigFile(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

export function normalizeProvider(provider) {
  if (!provider) return null;
  const normalized = String(provider).trim().toLowerCase();
  return PROVIDERS[normalized] ? normalized : null;
}

export function getProvider(provider) {
  const normalized = normalizeProvider(provider);
  return normalized ? PROVIDERS[normalized] : null;
}

export function getProviderModels(provider) {
  const item = getProvider(provider);
  return item ? item.models.slice(0, 5) : [];
}

export function getModel(provider, modelId) {
  return getProviderModels(provider).find((item) => item.id === modelId) || null;
}

export function maskApiKey(value) {
  if (!value) return null;
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function resolveApiKey(provider, config) {
  const providerInfo = getProvider(provider);
  if (!providerInfo) return null;
  return process.env[providerInfo.apiKeyEnv] || config.api_keys?.[provider] || null;
}

async function prompt(question) {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function parseSelection(value, max) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 1 || index > max) return null;
  return index - 1;
}

export async function ensureConfigInteractive(options = {}) {
  const {
    provider: providerArg,
    model: modelArg,
    apiKey: apiKeyArg,
    force = false,
  } = options;

  let config = await loadConfig();
  let provider = normalizeProvider(providerArg) || normalizeProvider(config.default_provider) || 'deepseek';
  let model = modelArg || config.default_model;
  let apiKey = apiKeyArg || resolveApiKey(provider, config);

  if (!providerArg && !config.default_provider && !process.stdin.isTTY) {
    throw new Error('缺少 provider 配置，且当前不是交互式终端');
  }

  if ((force || !providerArg) && process.stdin.isTTY && (!config.default_provider || force)) {
    console.log('请选择翻译供应商:');
    const providers = Object.values(PROVIDERS);
    providers.forEach((item, index) => {
      console.log(`  [${index + 1}] ${item.name}`);
    });
    const providerAnswer = await prompt(`输入编号 [默认 ${providers.findIndex((item) => item.id === provider) + 1 || 1}]: `);
    const selectedIndex = providerAnswer ? parseSelection(providerAnswer, providers.length) : providers.findIndex((item) => item.id === provider);
    provider = providers[selectedIndex >= 0 ? selectedIndex : 0].id;
  }

  if (!getProvider(provider)) {
    throw new Error(`不支持的 provider: ${provider}`);
  }

  const models = getProviderModels(provider);
  if (!getModel(provider, model) || force || (providerArg && !modelArg)) {
    if (!process.stdin.isTTY && !modelArg) {
      throw new Error(`provider=${provider} 缺少 model 配置，且当前不是交互式终端`);
    }
    if (process.stdin.isTTY) {
      console.log(`\n请选择 ${PROVIDERS[provider].name} 模型:`);
      models.forEach((item, index) => {
        console.log(`  [${index + 1}] ${item.id} - ${item.description}`);
      });
      const defaultIndex = Math.max(0, models.findIndex((item) => item.id === model));
      const modelAnswer = await prompt(`输入编号 [默认 ${defaultIndex + 1}]: `);
      const selectedIndex = modelAnswer ? parseSelection(modelAnswer, models.length) : defaultIndex;
      model = models[selectedIndex >= 0 ? selectedIndex : defaultIndex].id;
    } else {
      model = models[0]?.id || null;
    }
  }

  if (!model) {
    throw new Error(`provider=${provider} 没有可用模型`);
  }

  if (!apiKey || force || providerArg !== normalizeProvider(config.default_provider)) {
    if (!process.stdin.isTTY && !apiKeyArg) {
      throw new Error(`provider=${provider} 缺少 API key，且当前不是交互式终端`);
    }
    if (process.stdin.isTTY && !apiKeyArg) {
      const answer = await prompt(`请输入 ${PROVIDERS[provider].name} API key: `);
      apiKey = answer || apiKey;
    }
  }

  if (!apiKey) {
    throw new Error(`provider=${provider} 缺少 API key`);
  }

  config = await saveConfig({
    ...config,
    default_provider: provider,
    default_model: model,
    api_keys: {
      ...(config.api_keys || {}),
      [provider]: apiKey,
    },
  });

  return {
    provider,
    model,
    apiKey,
    config,
  };
}

const LANGUAGE_PATTERNS = [
  { label: '中文', patterns: [/翻译成中文/i, /译成中文/i, /翻成中文/i, /translate (it )?to chinese/i, /in chinese/i, /中文版本/i] },
  { label: '英文', patterns: [/翻译成英文/i, /译成英文/i, /翻成英文/i, /translate (it )?to english/i, /in english/i] },
  { label: '日文', patterns: [/翻译成日文/i, /译成日文/i, /翻成日文/i, /翻译成日语/i, /translate (it )?to japanese/i, /in japanese/i] },
  { label: '韩文', patterns: [/翻译成韩文/i, /译成韩文/i, /翻成韩文/i, /translate (it )?to korean/i, /in korean/i] },
  { label: '法文', patterns: [/翻译成法文/i, /译成法文/i, /翻成法文/i, /translate (it )?to french/i, /in french/i] },
  { label: '德文', patterns: [/翻译成德文/i, /译成德文/i, /翻成德文/i, /translate (it )?to german/i, /in german/i] },
  { label: '西班牙文', patterns: [/翻译成西班牙文/i, /译成西班牙文/i, /翻成西班牙文/i, /translate (it )?to spanish/i, /in spanish/i] },
  { label: '俄文', patterns: [/翻译成俄文/i, /译成俄文/i, /翻成俄文/i, /translate (it )?to russian/i, /in russian/i] },
];

export function detectTargetLanguageFromPrompt(promptText) {
  if (!promptText) return null;
  for (const item of LANGUAGE_PATTERNS) {
    if (item.patterns.some((pattern) => pattern.test(promptText))) {
      return item.label;
    }
  }
  return null;
}

const DOMAIN_RULES = [
  {
    id: 'ai-tech',
    label: '科技 / AI',
    translatorRole: '你是一名资深科技、AI 与软件工程文章翻译专家。',
    keywords: ['ai', 'model', 'models', 'agent', 'agents', 'llm', 'openai', 'deepseek', 'gemini', 'codex', 'prompt', 'api', 'sdk', 'code', 'coding', 'repo', 'repository', 'software', 'engineering', 'developer', 'benchmark'],
  },
  {
    id: 'finance',
    label: '金融 / 商业',
    translatorRole: '你是一名资深金融与商业分析文章翻译专家。',
    keywords: ['finance', 'financial', 'market', 'markets', 'revenue', 'valuation', 'investment', 'investor', 'business', 'commercial', 'profit', 'earnings', 'stock'],
  },
  {
    id: 'legal-policy',
    label: '法律 / 政策',
    translatorRole: '你是一名资深法律与政策文章翻译专家。',
    keywords: ['law', 'legal', 'policy', 'regulation', 'regulatory', 'compliance', 'court', 'contract', 'privacy', 'government'],
  },
  {
    id: 'medical',
    label: '医疗 / 科研',
    translatorRole: '你是一名资深医学与科研文章翻译专家。',
    keywords: ['medical', 'medicine', 'clinical', 'patient', 'research', 'study', 'biology', 'health', 'treatment', 'disease'],
  },
];

export function analyzeArticle(markdown) {
  const normalized = String(markdown || '').toLowerCase();
  const titleMatch = String(markdown || '').match(/^title:\s*"?(.+?)"?$/m) || String(markdown || '').match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : '';
  let best = {
    id: 'general',
    label: '通用',
    translatorRole: '你是一名资深长文翻译专家。',
    matchedKeywords: [],
    score: 0,
    title,
  };

  for (const rule of DOMAIN_RULES) {
    const matchedKeywords = rule.keywords.filter((keyword) => normalized.includes(keyword));
    if (matchedKeywords.length > best.score) {
      best = {
        id: rule.id,
        label: rule.label,
        translatorRole: rule.translatorRole,
        matchedKeywords,
        score: matchedKeywords.length,
        title,
      };
    }
  }

  return best;
}

export function buildSystemPrompt({ analysis, targetLanguage, userPrompt }) {
  const focus = analysis.matchedKeywords?.length
    ? `文章主题更接近 ${analysis.label}，关键词包括：${analysis.matchedKeywords.slice(0, 8).join('、')}。`
    : `文章主题为通用长文，请根据上下文保持专业、自然、准确。`;

  return [
    analysis.translatorRole,
    `你的任务是把用户提供的 Markdown 文章完整翻译为${targetLanguage}。`,
    focus,
    '严格保留原 Markdown 结构，包括 frontmatter、标题层级、列表、引用、代码块、图片、链接 URL。',
    '只翻译人类可读文本，不要改动 URL、图片地址、代码内容、YAML 键名、HTML 标签名。',
    '术语翻译要统一；对 AI、编程、产品名等术语，必要时保留英文原词或采用行业常用译法。',
    '译文要自然、克制、专业，不要额外解释，不要加译者注，不要总结。',
    '如果原文语气偏技术分析，就保持技术分析语气；如果原文有营销或评论色彩，也要保留原有风格。',
    userPrompt ? `用户额外要求：${userPrompt}` : '',
  ].filter(Boolean).join('\n');
}

export function buildUserPrompt({ markdown, targetLanguage, userPrompt }) {
  return [
    `请把下面的 Markdown 文章翻译为${targetLanguage}。`,
    userPrompt ? `额外要求：${userPrompt}` : '',
    '',
    '请直接输出翻译后的完整 Markdown，不要添加解释。',
    '',
    markdown,
  ].filter(Boolean).join('\n');
}

export function summarizeConfig(config) {
  return {
    config_file: getConfigFile(),
    default_provider: config.default_provider || null,
    default_model: config.default_model || null,
    api_keys: Object.fromEntries(
      Object.entries(config.api_keys || {}).map(([provider, key]) => [provider, maskApiKey(key)])
    ),
    updated_at: config.updated_at || null,
  };
}
