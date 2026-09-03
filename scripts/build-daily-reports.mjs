#!/usr/bin/env node
import { resolve } from 'node:path';
import { fetchLotteryMatches, fetchSituations, tagRangeLabel } from './lib/dqd-client.mjs';
import { configDir, enrichmentsDir, reportsDir } from './lib/paths.mjs';
import { readJson, weekdayLabelFromIsoDate, writeJson, yesterdayInTimeZone } from './lib/utils.mjs';
import { hydrateMatch } from './lib/reporting.mjs';

function parseArgs(argv) {
  const options = {
    date: '',
    minTag: 1,
    maxTag: 25,
    timezone: 'Asia/Shanghai',
    concurrency: 6,
    scheduleTimeoutMs: 10000,
    situationTimeoutMs: 10000,
    outFile: '',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--date' && next) options.date = next;
    if (arg === '--min-tag' && next) options.minTag = Number(next) || 1;
    if (arg === '--max-tag' && next) options.maxTag = Number(next) || 25;
    if (arg === '--timezone' && next) options.timezone = next;
    if (arg === '--concurrency' && next) options.concurrency = Math.max(1, Number(next) || 6);
    if (arg === '--schedule-timeout' && next) options.scheduleTimeoutMs = Math.max(1000, Number(next) || 10000);
    if (arg === '--situation-timeout' && next) options.situationTimeoutMs = Math.max(1000, Number(next) || 10000);
    if (arg === '--out' && next) options.outFile = next;
  }

  if (!options.date) options.date = yesterdayInTimeZone(options.timezone);
  return options;
}

async function main() {
  const options = parseArgs(process.argv);
  const styleGuide = await readJson(resolve(configDir, 'report-style.json'), {});
  const enrichments = await readJson(resolve(enrichmentsDir, `${options.date}.json`), { matches: [] });

  const matches = await fetchLotteryMatches({
    date: options.date,
    minTag: options.minTag,
    maxTag: options.maxTag,
    timeoutMs: options.scheduleTimeoutMs,
  });

  if (!matches.length) {
    throw new Error(`未找到 ${options.date} 的竞彩比赛，筛选范围为 ${tagRangeLabel(options.minTag, options.maxTag)}。`);
  }

  const detailMap = await fetchSituations(matches, {
    concurrency: options.concurrency,
    timeoutMs: options.situationTimeoutMs,
  });

  const enrichmentMap = new Map(
    (enrichments?.matches || []).map((item) => [String(item.matchId), item]),
  );

  const hydratedMatches = matches.map((match) => hydrateMatch({
    ...match,
    detail: detailMap.get(match.matchId) || {
      stats: {},
      timeline: [],
      ranks: { home: match.homeTeam.rank, away: match.awayTeam.rank },
      marketValue: { home: null, away: null },
    },
  }, enrichmentMap.get(match.matchId) || {}, styleGuide));

  const document = {
    version: 1,
    generatedAt: new Date().toISOString(),
    timezone: options.timezone,
    date: options.date,
    filter: {
      issueWeekday: weekdayLabelFromIsoDate(options.date),
      minTag: options.minTag,
      maxTag: options.maxTag,
      count: hydratedMatches.length,
    },
    source: {
      provider: 'dongqiudi',
      scheduleEndpoint: process.env.DQD_SCHEDULE_ENDPOINT || 'https://api.dongqiudi.com/data/tab/new/lottery',
      situationEndpoint: process.env.DQD_SITUATION_ENDPOINT || 'https://api.dongqiudi.com/mobile/match/situation/{matchId}',
    },
    matches: hydratedMatches,
  };

  const outFile = options.outFile || resolve(reportsDir, `${options.date}.json`);
  await writeJson(outFile, document);
  process.stdout.write(`wrote ${outFile}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
