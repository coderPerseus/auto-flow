#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'];
const COMMON_PORTS = [9222, 9229, 9333];
export const CACHE_FILE = path.join(os.tmpdir(), 'auto-flow-chrome-debug.json');

function uniqBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function quoteShell(value) {
  return `'${String(value ?? '').replace(/'/g, `'\"'\"'`)}'`;
}

function normalizeWsPath(wsPath) {
  if (!wsPath) return null;
  return wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
}

function wsUrlFromParts(host, port, wsPath) {
  return `ws://${host}:${port}${normalizeWsPath(wsPath) || '/devtools/browser'}`;
}

function parseWsUrl(wsUrl, source = 'env:wsUrl') {
  try {
    const parsed = new URL(wsUrl);
    if (!parsed.port) return null;
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parseInt(parsed.port, 10),
      wsPath: normalizeWsPath(parsed.pathname || '/devtools/browser'),
      wsUrl: `ws://${parsed.hostname}:${parsed.port}${normalizeWsPath(parsed.pathname || '/devtools/browser')}`,
      source,
    };
  } catch {
    return null;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(endpoint) {
  try {
    fs.writeFileSync(CACHE_FILE, `${JSON.stringify(endpoint, null, 2)}\n`);
  } catch {
    // ignore cache write failures
  }
}

export function activePortFiles() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  switch (process.platform) {
    case 'darwin':
      return [
        path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
      ];
    case 'linux':
      return [
        path.join(home, '.config/google-chrome/DevToolsActivePort'),
        path.join(home, '.config/chromium/DevToolsActivePort'),
      ];
    case 'win32':
      return [
        path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
        path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
      ];
    default:
      return [];
  }
}

export function getCandidateEndpoints() {
  const candidates = [];

  if (process.env.CHROME_DEBUG_WS_URL) {
    const parsed = parseWsUrl(process.env.CHROME_DEBUG_WS_URL, 'env:CHROME_DEBUG_WS_URL');
    if (parsed) candidates.push(parsed);
  }

  if (process.env.CHROME_DEBUG_PORT) {
    const port = parseInt(process.env.CHROME_DEBUG_PORT, 10);
    if (port > 0 && port < 65536) {
      candidates.push({
        host: process.env.CHROME_DEBUG_HOST || '127.0.0.1',
        port,
        wsPath: normalizeWsPath(process.env.CHROME_DEBUG_WS_PATH || null),
        source: 'env:CHROME_DEBUG_PORT',
      });
    }
  }

  const cached = readJsonFile(CACHE_FILE);
  if (cached?.port) {
    candidates.push({
      host: cached.host || '127.0.0.1',
      port: cached.port,
      wsPath: normalizeWsPath(cached.wsPath || null),
      wsUrl: cached.wsUrl || null,
      source: `cache:${CACHE_FILE}`,
    });
  }

  for (const filePath of activePortFiles()) {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536) {
        candidates.push({
          host: '127.0.0.1',
          port,
          wsPath: normalizeWsPath(lines[1] || null),
          source: `DevToolsActivePort:${filePath}`,
        });
      }
    } catch {
      // ignore missing files
    }
  }

  for (const port of COMMON_PORTS) {
    candidates.push({ host: '127.0.0.1', port, wsPath: null, source: 'common-port-scan' });
  }

  return uniqBy(candidates, (item) => `${item.host}:${item.port}:${item.wsPath || ''}`);
}

export function checkPort(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function fetchJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function collectLsofCandidates() {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
    const lines = stdout.split(/\r?\n/).slice(1).filter(Boolean);
    const matches = [];
    for (const line of lines) {
      if (!/(chrome|chromium|edge|arc)/i.test(line)) continue;
      const portMatch = line.match(/(?:127\.0\.0\.1|localhost|\*)[:.]([0-9]{2,5})\s+\(LISTEN\)/i);
      if (!portMatch) continue;
      const port = parseInt(portMatch[1], 10);
      if (!(port > 0 && port < 65536)) continue;
      matches.push({ host: '127.0.0.1', port, wsPath: null, source: 'lsof-listen-scan' });
    }
    return uniqBy(matches, (item) => `${item.host}:${item.port}`);
  } catch {
    return [];
  }
}

async function probeCandidate(candidate) {
  const hosts = uniqBy([candidate.host || '127.0.0.1', ...LOOPBACK_HOSTS], (host) => host);
  for (const host of hosts) {
    const ok = await checkPort(host, candidate.port);
    if (!ok) continue;

    const httpBase = `http://${host}:${candidate.port}`;
    let wsUrl = candidate.wsUrl || null;
    let browserVersion = null;

    try {
      const versionInfo = await fetchJson(`${httpBase}/json/version`);
      browserVersion = versionInfo?.Browser || null;
      if (versionInfo?.webSocketDebuggerUrl) {
        const parsed = parseWsUrl(versionInfo.webSocketDebuggerUrl, candidate.source);
        if (parsed) {
          wsUrl = parsed.wsUrl;
        }
      }
    } catch {
      // Some Chrome debug modes do not expose /json/version; wsPath fallback still works.
    }

    const wsPath = normalizeWsPath(candidate.wsPath || (wsUrl ? new URL(wsUrl).pathname : null));
    const endpoint = {
      host,
      port: candidate.port,
      wsPath,
      wsUrl: wsUrl || wsUrlFromParts(host, candidate.port, wsPath),
      httpBase,
      source: candidate.source,
      browserVersion,
      cacheFile: CACHE_FILE,
    };
    writeCache(endpoint);
    return endpoint;
  }
  return null;
}

export async function discoverChromeDebugEndpoint() {
  const candidates = [...getCandidateEndpoints(), ...(await collectLsofCandidates())];
  for (const candidate of uniqBy(candidates, (item) => `${item.host}:${item.port}:${item.wsPath || ''}`)) {
    const endpoint = await probeCandidate(candidate);
    if (endpoint) return endpoint;
  }
  return null;
}

async function main() {
  const endpoint = await discoverChromeDebugEndpoint();
  if (!endpoint) process.exit(1);

  const args = new Set(process.argv.slice(2));
  const fieldIndex = process.argv.indexOf('--field');
  const field = fieldIndex >= 0 ? process.argv[fieldIndex + 1] : null;

  if (args.has('--shell')) {
    process.stdout.write(
      [
        `export CHROME_DEBUG_HOST=${quoteShell(endpoint.host)}`,
        `export CHROME_DEBUG_PORT=${quoteShell(endpoint.port)}`,
        `export CHROME_DEBUG_WS_PATH=${quoteShell(endpoint.wsPath || '')}`,
        `export CHROME_DEBUG_WS_URL=${quoteShell(endpoint.wsUrl)}`,
        `export CHROME_DEBUG_HTTP_BASE=${quoteShell(endpoint.httpBase)}`,
        `export CHROME_DEBUG_SOURCE=${quoteShell(endpoint.source)}`,
        `export CHROME_DEBUG_CACHE_FILE=${quoteShell(endpoint.cacheFile)}`,
      ].join('\n') + '\n',
    );
    return;
  }

  if (field) {
    process.stdout.write(`${endpoint[field] ?? ''}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(endpoint, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
