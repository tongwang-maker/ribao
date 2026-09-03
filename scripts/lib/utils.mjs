import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function integerOrNull(value) {
  const number = numberOrNull(value);
  return Number.isInteger(number) ? number : number === null ? null : Math.round(number);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function pad3(value) {
  return String(value).padStart(3, '0');
}

export function toIsoDateFromParts(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function zonedDateParts(date, timeZone = 'Asia/Shanghai') {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

export function dateStringInTimeZone(date = new Date(), timeZone = 'Asia/Shanghai') {
  return toIsoDateFromParts(zonedDateParts(date, timeZone));
}

export function shiftIsoDate(isoDate, offsetDays) {
  const pivot = new Date(`${isoDate}T12:00:00Z`);
  pivot.setUTCDate(pivot.getUTCDate() + offsetDays);
  return dateStringInTimeZone(pivot, 'UTC');
}

export function yesterdayInTimeZone(timeZone = 'Asia/Shanghai', baseDate = new Date()) {
  return shiftIsoDate(dateStringInTimeZone(baseDate, timeZone), -1);
}

export function weekdayLabelFromIsoDate(isoDate) {
  const weekdayMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const date = new Date(`${isoDate}T12:00:00Z`);
  return weekdayMap[date.getUTCDay()];
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(path, value) {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(path, value) {
  await ensureDir(dirname(path));
  await writeFile(path, value, 'utf8');
}

export async function listJsonFiles(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatDateChinese(isoDate) {
  const [year, month, day] = String(isoDate).split('-').map((value) => Number(value) || value);
  return `${year}年${month}月${day}日`;
}

export function shortDateLabel(dateTime) {
  const [datePart, timePart] = String(dateTime || '').split(' ');
  const [year, month, day] = datePart.split('-').map((value) => Number(value) || value);
  const hhmm = String(timePart || '').slice(0, 5);
  return `${month}月${day}日${hhmm ? ` ${hhmm}` : ''}`;
}

export function pickStat(stats, label) {
  return stats?.[label] || { home: null, away: null };
}

export function winnerSide(score) {
  if ((score?.home ?? 0) > (score?.away ?? 0)) return 'home';
  if ((score?.home ?? 0) < (score?.away ?? 0)) return 'away';
  return 'draw';
}

export function scoreline(score) {
  return `${score?.home ?? '-'}-${score?.away ?? '-'}`;
}

export function compactNumber(value) {
  const number = numberOrNull(value);
  return number === null ? '未知' : String(number);
}

export function distinct(array) {
  return [...new Set(array)];
}

export function basenameFromUrl(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.at(-1) || '';
  } catch {
    return '';
  }
}
