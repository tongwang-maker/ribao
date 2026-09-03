#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { enrichmentsDir } from './lib/paths.mjs';
import { readJson, writeJson } from './lib/utils.mjs';

function parseArgs(argv) {
  const options = {
    file: process.env.GITHUB_EVENT_PATH || '',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--file' && next) options.file = next;
  }

  return options;
}

function normalizeMatchPayload(match) {
  return {
    matchId: String(match.matchId || ''),
    image: match.image || null,
    expectation: match.expectation || null,
    notes: match.notes || '',
  };
}

async function loadPayload(file) {
  if (!file) throw new Error('缺少 dispatch payload 文件。');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const payload = raw.client_payload || raw;
  if (!payload?.date) throw new Error('dispatch payload 缺少 date。');
  if (!Array.isArray(payload.matches)) throw new Error('dispatch payload 缺少 matches 数组。');
  return payload;
}

async function main() {
  const options = parseArgs(process.argv);
  const payload = await loadPayload(options.file);
  const file = resolve(enrichmentsDir, `${payload.date}.json`);
  const existing = await readJson(file, { date: payload.date, matches: [] });
  const byMatchId = new Map((existing.matches || []).map((match) => [String(match.matchId), match]));

  for (const item of payload.matches) {
    const normalized = normalizeMatchPayload(item);
    if (!normalized.matchId) continue;
    const previous = byMatchId.get(normalized.matchId) || { matchId: normalized.matchId };
    byMatchId.set(normalized.matchId, {
      ...previous,
      ...normalized,
      image: normalized.image || previous.image || null,
      expectation: normalized.expectation || previous.expectation || null,
      notes: normalized.notes || previous.notes || '',
    });
  }

  const merged = {
    date: payload.date,
    generatedAt: new Date().toISOString(),
    matches: [...byMatchId.values()].sort((a, b) => String(a.matchId).localeCompare(String(b.matchId))),
  };

  await writeJson(file, merged);
  process.stdout.write(`merged ${payload.matches.length} records into ${file}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
