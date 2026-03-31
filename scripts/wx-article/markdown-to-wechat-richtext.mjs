#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
import { load } from 'cheerio';
import css from 'css';

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    cssFile: null,
    baseCssFile: null,
    keepFrontmatter: false,
    keepLocalImages: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      args.input = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      args.output = argv[++i];
    } else if (arg === '--css-file' && argv[i + 1]) {
      args.cssFile = argv[++i];
    } else if (arg === '--base-css-file' && argv[i + 1]) {
      args.baseCssFile = argv[++i];
    } else if (arg === '--keep-frontmatter') {
      args.keepFrontmatter = true;
    } else if (arg === '--keep-local-images') {
      args.keepLocalImages = true;
    }
  }

  if (!args.input || !args.output) {
    throw new Error('用法: node markdown-to-wechat-richtext.mjs --input <markdown> --output <richtext-file> [--base-css-file <css>] [--css-file <css>] [--keep-frontmatter] [--keep-local-images]');
  }

  return args;
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return markdown;
  return markdown.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

function isRemoteImage(src) {
  return /^https?:\/\//i.test(src) || /^data:/i.test(src);
}

function wrapHeading($el) {
  if ($el.children('.content').length) return;
  const inner = $el.html() || '';
  $el.html(`<span class="prefix"></span><span class="content">${inner}</span><span class="suffix"></span>`);
}

function wrapListSections($) {
  $('#nice li').each((_, element) => {
    const $li = $(element);
    if ($li.children('section').length === 1 && $li.contents().length === 1) return;
    const html = $li.contents().toArray().map((node) => $.html(node)).join('');
    $li.html(`<section>${html}</section>`);
  });
}

function annotateBlockquotes($, $root, depth = 1) {
  $root.children('blockquote').each((_, element) => {
    const $blockquote = $(element);
    $blockquote.addClass(`multiquote-${Math.min(depth, 3)}`);
    annotateBlockquotes($, $blockquote, depth + 1);
  });
}

function normalizeFootnotes($) {
  $('#nice .footnotes').addClass('footnotes-wrapper');
  $('#nice .footnotes li').addClass('footnote-item');
  $('#nice .footnote-ref').addClass('footnote-ref');
  $('#nice .footnotes-sep').addClass('footnotes-sep');
  $('#nice .footnotes li').each((_, element) => {
    const $li = $(element);
    const firstLink = $li.find('a').first();
    if (firstLink.length) firstLink.addClass('footnote-num');
  });
}

function pruneEmptyParagraphs($) {
  $('#nice p').each((_, element) => {
    const $p = $(element);
    const hasMeaningfulChild = $p.find('img,br,code,strong,em,a,svg').length > 0;
    if (!hasMeaningfulChild && !$p.text().trim()) {
      $p.remove();
    }
  });
}

function shapeForMdnice($) {
  $('#nice h1, #nice h2, #nice h3').each((_, element) => {
    wrapHeading($(element));
  });

  wrapListSections($);
  annotateBlockquotes($, $('#nice'));
  normalizeFootnotes($);
}

function parseInlineStyle(styleAttr = '') {
  const entries = new Map();
  for (const chunk of styleAttr.split(';')) {
    const [rawProp, rawValue] = chunk.split(':');
    if (!rawProp || !rawValue) continue;
    entries.set(rawProp.trim(), rawValue.trim());
  }
  return entries;
}

function applyInlineStyles($, cssText) {
  if (!cssText.trim()) return;
  const ast = css.parse(cssText, { silent: true });
  const elementStyles = new Map();

  for (const rule of ast.stylesheet?.rules || []) {
    if (rule.type !== 'rule' || !rule.selectors?.length) continue;
    const declarations = (rule.declarations || [])
      .filter((item) => item.type === 'declaration' && item.property && item.value)
      .map((item) => [item.property.trim(), item.value.trim()]);

    if (!declarations.length) continue;

    for (const selector of rule.selectors) {
      if (!selector.trim()) continue;
      let matched;
      try {
        matched = $(selector);
      } catch {
        continue;
      }

      matched.each((_, element) => {
        const existing = elementStyles.get(element) || parseInlineStyle($(element).attr('style'));
        for (const [property, value] of declarations) {
          existing.set(property, value);
        }
        elementStyles.set(element, existing);
      });
    }
  }

  for (const [element, styles] of elementStyles.entries()) {
    const serialized = Array.from(styles.entries())
      .map(([property, value]) => `${property}: ${value}`)
      .join('; ');
    if (serialized) {
      $(element).attr('style', `${serialized};`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  const defaultCssPath = path.resolve(scriptDir, '..', '..', 'references', 'wx-article-theme.css');
  const cssChunks = [];
  if (args.baseCssFile) {
    cssChunks.push(await fs.readFile(path.resolve(args.baseCssFile), 'utf8'));
  }
  const cssFilePath = args.cssFile ? path.resolve(args.cssFile) : defaultCssPath;
  try {
    cssChunks.push(await fs.readFile(cssFilePath, 'utf8'));
  } catch (error) {
    if (args.cssFile) {
      throw error;
    }
  }
  const cssText = cssChunks.join('\n\n');

  let markdown = await fs.readFile(inputPath, 'utf8');
  if (!args.keepFrontmatter) {
    markdown = stripFrontmatter(markdown);
  }

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
  }).use(markdownItFootnote);

  const renderedHtml = md.render(markdown);
  const $ = load(`<section id="nice">${renderedHtml}</section>`, {
    decodeEntities: false,
  });

  shapeForMdnice($);

  if (!args.keepLocalImages) {
    $('#nice img').each((_, element) => {
      const src = $(element).attr('src') || '';
      if (!isRemoteImage(src)) {
        $(element).remove();
      }
    });
  }

  pruneEmptyParagraphs($);
  applyInlineStyles($, cssText);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${$.html('#nice')}\n`);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
