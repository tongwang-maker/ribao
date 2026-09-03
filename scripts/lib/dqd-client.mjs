import {
  basenameFromUrl,
  clamp,
  distinct,
  integerOrNull,
  numberOrNull,
  pad3,
  shiftIsoDate,
  weekdayLabelFromIsoDate,
} from './utils.mjs';

const DEFAULT_SCHEDULE_ENDPOINT = process.env.DQD_SCHEDULE_ENDPOINT
  || 'https://api.dongqiudi.com/data/tab/new/lottery';
const DEFAULT_SITUATION_ENDPOINT = process.env.DQD_SITUATION_ENDPOINT
  || 'https://api.dongqiudi.com/mobile/match/situation';

function apiRequestHeaders() {
  const headers = {
    accept: 'application/json',
    'user-agent': 'Mozilla/5.0',
    referer: 'https://n.dongqiudi.com/',
  };
  if (process.env.DQD_AUTHORIZATION) headers.authorization = process.env.DQD_AUTHORIZATION;
  if (process.env.DQD_COOKIE) headers.cookie = process.env.DQD_COOKIE;
  return headers;
}

async function requestJson(url, { timeoutMs = 8000, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        ...apiRequestHeaders(),
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`请求超时: ${url}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseZcTag(tag) {
  const text = String(tag || '').trim();
  const match = text.match(/^(周[一二三四五六日天]|北单)?(\d{3})(?:\s+单关)?$/);
  if (!match) return null;
  return {
    prefix: match[1] || '',
    seq: Number(match[2]),
    code: match[2],
    label: text,
  };
}

function normalizeScore(home, away) {
  return {
    home: integerOrNull(home),
    away: integerOrNull(away),
  };
}

function normalizeMatchRow(row) {
  const tag = parseZcTag(row?.zc_tag);
  if (!tag) return null;
  return {
    cmpType: row.cmp_type || '',
    tag: row.zc_tag,
    tagSeq: tag.seq,
    tagCode: tag.code,
    matchId: String(row.match_id || row.relate_id || ''),
    competition: row.competition_name || '',
    round: row.round_name || '',
    kickoff: row.start_play || [row.date_utc, row.time_utc].filter(Boolean).join(' '),
    finishedAt: row.end_play || '',
    date: row.date_utc || '',
    status: row.status || '',
    homeTeam: {
      id: String(row.team_A_id || ''),
      name: row.team_A_name || '',
      logo: row.team_A_logo || '',
      rank: integerOrNull(row.rank_A),
    },
    awayTeam: {
      id: String(row.team_B_id || ''),
      name: row.team_B_name || '',
      logo: row.team_B_logo || '',
      rank: integerOrNull(row.rank_B),
    },
    score: {
      ...normalizeScore(row.fs_A, row.fs_B),
      halfHome: integerOrNull(row.hts_A),
      halfAway: integerOrNull(row.hts_B),
      penaltyHome: integerOrNull(row.ps_A),
      penaltyAway: integerOrNull(row.ps_B),
      extraHome: integerOrNull(row.ets_A),
      extraAway: integerOrNull(row.ets_B),
    },
    surfaceStats: {
      cornersHome: integerOrNull(row.corner_A),
      cornersAway: integerOrNull(row.corner_B),
      yellowHome: integerOrNull(row.yc_A),
      yellowAway: integerOrNull(row.yc_B),
      redHome: integerOrNull(row.rc_A),
      redAway: integerOrNull(row.rc_B),
    },
    expectationSignals: {
      oddsHome: row.home || '',
      oddsDraw: row.draw || '',
      oddsAway: row.away || '',
      handicapText: row.draw_num || row.draw || '',
      goalsText: row.hdp || '',
      tipsNum: integerOrNull(row.tips_num),
    },
    raw: {
      scoreInfo: row.score_info || '',
      oddTip: row.odd_tip || '',
      liveUrl: Array.isArray(row.tv_live_info) ? row.tv_live_info[0]?.url || '' : '',
    },
  };
}

export async function fetchLotteryMatches({
  date,
  minTag = 1,
  maxTag = 25,
  scheduleEndpoint = DEFAULT_SCHEDULE_ENDPOINT,
  timeoutMs = 10000,
} = {}) {
  const issueWeekday = weekdayLabelFromIsoDate(date);
  const nextDate = shiftIsoDate(date, 1);
  const url = new URL(scheduleEndpoint);
  if (!url.searchParams.has('start')) url.searchParams.set('start', `${date} 00:00:00`);
  if (!url.searchParams.has('init')) url.searchParams.set('init', '1');
  if (!url.searchParams.has('wfrom')) url.searchParams.set('wfrom', '2');

  const payload = await requestJson(url, { timeoutMs });
  const list = Array.isArray(payload?.list) ? payload.list : [];

  return list
    .map(normalizeMatchRow)
    .filter(Boolean)
    .filter((match) => (
      match.cmpType === 'soccer'
      && !String(match.tag).startsWith('北单')
      && String(match.tag).startsWith(issueWeekday)
      && (match.date === date || match.date === nextDate)
      && match.status === 'Played'
      && match.tagSeq >= minTag
      && match.tagSeq <= maxTag
    ))
    .sort((a, b) => a.tagSeq - b.tagSeq);
}

function statisticMap(list) {
  return Object.fromEntries(
    (list || []).map((item) => [
      item.type,
      {
        home: numberOrNull(item?.team_A?.value),
        away: numberOrNull(item?.team_B?.value),
      },
    ]),
  );
}

function inferEventFamily(iconName) {
  const name = String(iconName || '');
  if (name === 'HT.png') return 'half-time';
  return name.replace(/\.[A-Za-z0-9]+$/, '').slice(0, 12);
}

function normalizeEvents(events) {
  const rows = Object.values(events || {})
    .map((entry) => {
      const home = Array.isArray(entry?.teamAEvents) ? entry.teamAEvents : [];
      const away = Array.isArray(entry?.teamBEvents) ? entry.teamBEvents : [];
      return {
        minute: integerOrNull(entry?.minute),
        home,
        away,
      };
    })
    .filter((row) => row.minute !== null)
    .sort((a, b) => a.minute - b.minute);

  const substitutionFamilies = distinct(
    rows
      .filter((row) => row.home.length + row.away.length >= 4)
      .flatMap((row) => [...row.home, ...row.away])
      .map((event) => inferEventFamily(basenameFromUrl(event.event_pic))),
  );

  return rows.map((row) => {
    const homeEvents = row.home.map((event) => ({
      player: event.person || '',
      icon: basenameFromUrl(event.event_pic),
      family: inferEventFamily(basenameFromUrl(event.event_pic)),
    }));
    const awayEvents = row.away.map((event) => ({
      player: event.person || '',
      icon: basenameFromUrl(event.event_pic),
      family: inferEventFamily(basenameFromUrl(event.event_pic)),
    }));

    const candidates = [];
    if (
      row.home.length > 0
      && row.home.length <= 2
      && row.away.length === 0
      && !homeEvents.some((event) => event.family === 'half-time' || substitutionFamilies.includes(event.family))
    ) {
      candidates.push({ side: 'home', minute: row.minute, players: homeEvents.map((event) => event.player).filter(Boolean) });
    }
    if (
      row.away.length > 0
      && row.away.length <= 2
      && row.home.length === 0
      && !awayEvents.some((event) => event.family === 'half-time' || substitutionFamilies.includes(event.family))
    ) {
      candidates.push({ side: 'away', minute: row.minute, players: awayEvents.map((event) => event.player).filter(Boolean) });
    }

    return {
      minute: row.minute,
      home: homeEvents,
      away: awayEvents,
      candidates,
    };
  });
}

function normalizeSituationPayload(payload, fallbackMatch) {
  const match = payload?.match || {};
  const statistics = payload?.info?.statistics?.list || [];
  return {
    matchId: String(payload?.matchid || fallbackMatch?.matchId || ''),
    competition: match?.competition?.short_name || match?.competition?.name || fallbackMatch?.competition || '',
    venue: match?.venue?.name || '',
    weather: match?.weather || '',
    temperature: match?.temperature || '',
    attendance: integerOrNull(match?.attendance),
    ranks: {
      home: integerOrNull(match?.team_A?.rank?.rank) ?? fallbackMatch?.homeTeam?.rank ?? null,
      away: integerOrNull(match?.team_B?.rank?.rank) ?? fallbackMatch?.awayTeam?.rank ?? null,
    },
    marketValue: {
      home: integerOrNull(match?.team_A?.market_value),
      away: integerOrNull(match?.team_B?.market_value),
    },
    stats: statisticMap(statistics),
    timeline: normalizeEvents(payload?.info?.events || {}),
  };
}

export async function fetchMatchSituation(
  match,
  {
    situationEndpoint = DEFAULT_SITUATION_ENDPOINT,
    timeoutMs = 10000,
  } = {},
) {
  const endpoint = String(situationEndpoint).replace(/\/$/, '');
  const payload = await requestJson(`${endpoint}/${match.matchId}`, {
    timeoutMs,
    headers: { accept: 'application/json' },
  });
  return normalizeSituationPayload(payload, match);
}

export async function fetchSituations(matches, { concurrency = 6, timeoutMs = 10000 } = {}) {
  const safeConcurrency = clamp(concurrency, 1, 12);
  let cursor = 0;
  const result = new Map();

  const worker = async () => {
    while (cursor < matches.length) {
      const current = matches[cursor];
      cursor += 1;
      const detail = await fetchMatchSituation(current, { timeoutMs });
      result.set(current.matchId, detail);
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(safeConcurrency, matches.length) },
    () => worker(),
  ));

  return result;
}

export function tagRangeLabel(minTag, maxTag) {
  return `${pad3(minTag)}-${pad3(maxTag)}`;
}
