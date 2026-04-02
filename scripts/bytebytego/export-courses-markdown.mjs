#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import TurndownService from 'turndown';

const args = process.argv.slice(2);

let outputDir = null;
let workflowName = 'bytebytego-course-export';
let limit = null;
let courseFilter = null;
let includeComingSoon = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--output-dir' && args[i + 1]) {
    outputDir = args[++i];
  } else if (arg === '--workflow-name' && args[i + 1]) {
    workflowName = args[++i];
  } else if (arg === '--limit' && args[i + 1]) {
    limit = Number.parseInt(args[++i], 10);
  } else if (arg === '--course' && args[i + 1]) {
    courseFilter = args[++i];
  } else if (arg === '--include-coming-soon') {
    includeComingSoon = true;
  }
}

const proxyBase = 'http://127.0.0.1:3456';
const myCoursesUrl = 'https://bytebytego.com/my-courses';
const baseDir = outputDir
  ? path.resolve(outputDir)
  : path.resolve('temp', workflowName);
const logsDir = path.join(baseDir, 'logs');

await fs.mkdir(baseDir, { recursive: true });
await fs.mkdir(logsDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fileSafeName(name) {
  return normalizeText(name).replace(/[\\/:*?"<>|]/g, ' ');
}

async function proxyJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`代理请求失败 (${res.status}): ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`代理返回非 JSON: ${text.slice(0, 500)}`);
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
    // 忽略关闭失败
  }
}

async function navigate(targetId, url) {
  await proxyJson(`${proxyBase}/navigate?target=${encodeURIComponent(targetId)}&url=${encodeURIComponent(url)}`);
}

async function clickAt(targetId, selector) {
  return proxyJson(`${proxyBase}/clickAt?target=${encodeURIComponent(targetId)}`, {
    method: 'POST',
    body: selector,
  });
}

async function click(targetId, selector) {
  return proxyJson(`${proxyBase}/click?target=${encodeURIComponent(targetId)}`, {
    method: 'POST',
    body: selector,
  });
}

async function waitFor(targetId, expression, timeoutMs = 20000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await proxyEval(targetId, expression);
      if (value) return value;
    } catch {
      // 页面切换期间忽略短暂失败
    }
    await sleep(intervalMs);
  }
  throw new Error(`等待条件超时: ${expression}`);
}

function buildTurndown() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });

  turndown.remove(['style', 'script', 'button', 'noscript']);

  turndown.addRule('tables', {
    filter(node) {
      return node.nodeName === 'TABLE';
    },
    replacement(_, node) {
      const rows = Array.from(node.querySelectorAll('tr')).map((row) =>
        Array.from(row.querySelectorAll('th,td')).map((cell) =>
          normalizeText(cell.textContent).replace(/\|/g, '\\|')
        )
      ).filter((row) => row.length > 0);

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

function cleanMarkdown(text) {
  return String(text || '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function stripLeadingTitle(markdown, title) {
  const normalizedTitle = normalizeText(title).toLowerCase();
  const lines = String(markdown || '').split('\n');
  if (lines[0]?.startsWith('# ')) {
    const firstHeading = normalizeText(lines[0].slice(2)).toLowerCase();
    if (!normalizedTitle || firstHeading === normalizedTitle) {
      return lines.slice(1).join('\n').trim();
    }
  }
  return markdown;
}

function lessonSectionMarkdown(index, lesson) {
  const body = lesson.markdown ? `\n\n${lesson.markdown}` : '\n';
  return [
    `## ${index}. ${lesson.title}`,
    '',
    `> Source: ${lesson.url}`,
    '',
    body.trimEnd(),
  ].join('\n');
}

const turndown = buildTurndown();

async function readCourseCards(targetId) {
  return proxyEval(targetId, `(() => {
    return JSON.stringify(
      Array.from(document.querySelectorAll('li.style_courseItem__MV4Ic')).map((li, index) => {
        const title = li.querySelector('img[alt]')?.getAttribute('alt') || '';
        const text = (li.innerText || '').trim();
        const lessonsText = li.querySelector('.style_courseInfo__aptKu i')?.textContent || '';
        const comingSoon = /coming soon/i.test(text);
        return {
          position: index + 1,
          title,
          text,
          lessonsText,
          comingSoon,
        };
      })
    );
  })()`);
}

async function openCourseFromCard(targetId, position) {
  await navigate(targetId, myCoursesUrl);
  await waitFor(
    targetId,
    `Array.from(document.querySelectorAll('li.style_courseItem__MV4Ic')).length >= ${Math.max(position, 1)}`
  );
  const selector = `li.style_courseItem__MV4Ic:nth-of-type(${position})`;
  await clickAt(targetId, selector);

  const entered = await waitFor(
    targetId,
    `(() => {
      if (!location.pathname.startsWith('/courses/')) return null;
      return JSON.stringify({ url: location.href });
    })()`,
    10000,
    500
  ).catch(async () => {
    await click(targetId, selector);
    return waitFor(
      targetId,
      `(() => {
        if (!location.pathname.startsWith('/courses/')) return null;
        return JSON.stringify({ url: location.href });
      })()`,
      10000,
      500
    );
  });

  return waitFor(
    targetId,
    `(() => {
      const courseTitle = document.querySelector('aside h2')?.textContent?.trim();
      if (!courseTitle) return null;
      return JSON.stringify({
        url: ${JSON.stringify(entered.url)} || location.href,
        courseTitle,
      });
    })()`,
    20000,
    500
  );
}

async function readCourseOutline(targetId) {
  return proxyEval(targetId, `(() => {
    const courseTitle = document.querySelector('aside h2')?.textContent?.trim() || '';
    const progress = document.querySelector('.style_progressText__cGdq7')?.textContent?.trim() || '';
    const lessons = Array.from(document.querySelectorAll('li[data-menu-id]')).map((li, index) => {
      const menuId = li.getAttribute('data-menu-id') || '';
      const match = menuId.match(/(\\/courses\\/[^\\s]+)$/);
      return {
        index: index + 1,
        title: (li.textContent || '').trim(),
        path: match ? match[1] : '',
      };
    }).filter((item) => item.path);

    return JSON.stringify({
      courseTitle,
      progress,
      lessons,
    });
  })()`);
}

async function readLesson(targetId, lessonUrl) {
  await navigate(targetId, lessonUrl);
  const payload = await waitFor(
    targetId,
    `(() => {
      const article = document.querySelector('article');
      const title = document.querySelector('article h1')?.textContent?.trim();
      if (!article || !title) return null;

      const clone = article.cloneNode(true);
      clone.querySelectorAll('style,script,button,noscript,.ant-anchor-wrapper,.ant-anchor').forEach((node) => node.remove());
      clone.querySelectorAll('a[href]').forEach((a) => {
        const raw = a.getAttribute('href') || a.href || '';
        try {
          a.setAttribute('href', new URL(raw, location.href).href);
        } catch {
          // ignore
        }
      });
      clone.querySelectorAll('img').forEach((img) => {
        const raw = img.currentSrc || img.getAttribute('src') || '';
        if (!raw) return;
        try {
          img.setAttribute('src', new URL(raw, location.href).href);
        } catch {
          img.setAttribute('src', raw);
        }
      });

      return JSON.stringify({
        url: location.href,
        title,
        html: clone.innerHTML,
      });
    })()`,
    20000,
    500
  );

  let markdown = cleanMarkdown(turndown.turndown(payload.html));
  markdown = stripLeadingTitle(markdown, payload.title);

  return {
    title: normalizeText(payload.title),
    url: payload.url,
    markdown,
  };
}

const runLog = {
  startedAt: new Date().toISOString(),
  outputDir: baseDir,
};

const targetId = await newTarget(myCoursesUrl);

try {
  await waitFor(
    targetId,
    `Array.from(document.querySelectorAll('li.style_courseItem__MV4Ic')).length >= 1`
  );

  const cards = await readCourseCards(targetId);
  await fs.writeFile(path.join(logsDir, 'course-cards.json'), JSON.stringify(cards, null, 2));

  let selectedCards = cards.filter((card) => includeComingSoon || !card.comingSoon);
  if (courseFilter) {
    const keyword = courseFilter.toLowerCase();
    selectedCards = selectedCards.filter((card) => card.title.toLowerCase().includes(keyword));
  }
  if (Number.isInteger(limit) && limit >= 0) {
    selectedCards = selectedCards.slice(0, limit);
  }
  if (selectedCards.length === 0) {
    throw new Error('没有找到可导出的课程。');
  }

  const exportedCourses = [];

  for (const card of selectedCards) {
    const opened = await openCourseFromCard(targetId, card.position);
    const outline = await readCourseOutline(targetId);
    const lessons = [];

    for (const item of outline.lessons) {
      const lessonUrl = new URL(item.path, 'https://bytebytego.com').href;
      const lesson = await readLesson(targetId, lessonUrl);
      lessons.push({
        ...lesson,
        path: item.path,
        menuTitle: normalizeText(item.title),
      });
    }

    const courseTitle = normalizeText(outline.courseTitle || opened.courseTitle || card.title);
    const courseBaseUrl = lessons[0]?.url ? lessons[0].url.replace(/\/p\d+-c\d+-.+$/, '') : opened.url;
    const toc = lessons.map((lesson, index) => `${index + 1}. ${lesson.title}`).join('\n');
    const body = lessons.map((lesson, index) => lessonSectionMarkdown(index + 1, lesson)).join('\n\n---\n\n');
    const markdown = [
      '---',
      `title: ${JSON.stringify(courseTitle)}`,
      `source: ${JSON.stringify(courseBaseUrl)}`,
      `lesson_count: ${lessons.length}`,
      `exported_at: ${JSON.stringify(new Date().toISOString())}`,
      '---',
      '',
      `# ${courseTitle}`,
      '',
      `> Course: ${courseBaseUrl}`,
      `> Lessons exported: ${lessons.length}`,
      '',
      '## Contents',
      '',
      toc,
      '',
      '---',
      '',
      body,
      '',
    ].join('\n');

    const courseFile = path.join(baseDir, `${fileSafeName(courseTitle)}.md`);
    await fs.writeFile(courseFile, markdown);

    const courseLog = {
      title: courseTitle,
      card,
      opened,
      outline,
      file: courseFile,
      lessons: lessons.map((lesson) => ({
        title: lesson.title,
        url: lesson.url,
        path: lesson.path,
      })),
    };
    await fs.writeFile(
      path.join(logsDir, `${fileSafeName(courseTitle)}.json`),
      JSON.stringify(courseLog, null, 2)
    );

    exportedCourses.push({
      title: courseTitle,
      file: courseFile,
      lessons: lessons.length,
    });
  }

  runLog.completedAt = new Date().toISOString();
  runLog.courses = exportedCourses;
  await fs.writeFile(path.join(logsDir, 'export-result.json'), JSON.stringify(runLog, null, 2));

  console.log(JSON.stringify(runLog, null, 2));
} finally {
  await closeTarget(targetId);
}
