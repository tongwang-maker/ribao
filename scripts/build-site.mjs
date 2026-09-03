#!/usr/bin/env node
import { resolve } from 'node:path';
import { hydrateMatch } from './lib/reporting.mjs';
import { configDir, docsDir, enrichmentsDir, reportsDir, templatesDir } from './lib/paths.mjs';
import {
  ensureDir,
  escapeHtml,
  formatDateChinese,
  listJsonFiles,
  readJson,
  scoreline,
  writeText,
} from './lib/utils.mjs';

function normalizeBasePath(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '/') return '';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

function joinHref(basePath, value) {
  const path = String(value || '');
  if (!basePath) return path || '/';
  if (!path || path === '/') return `${basePath}/`;
  return `${basePath}${path.startsWith('/') ? path : `/${path}`}`;
}

function renderImage(match) {
  if (match.image?.status === 'ready' && match.image.url) {
    const source = match.image.postUrl
      ? `<a class="match-image-meta" href="${escapeHtml(match.image.postUrl)}" target="_blank" rel="noreferrer">图源：${escapeHtml(match.image.source || 'official-social')}</a>`
      : `<span class="match-image-meta">图源：${escapeHtml(match.image.source || 'official-social')}</span>`;
    return `
      <figure class="match-image">
        <img src="${escapeHtml(match.image.url)}" alt="${escapeHtml(match.image.alt)}" loading="lazy">
        <figcaption>${escapeHtml(match.image.caption || '')}</figcaption>
        ${source}
      </figure>
    `;
  }

  return `
    <figure class="match-image match-image--pending">
      <div class="match-image-placeholder">
        <span>官方社媒过程图待补充</span>
        <small>Webhook 到仓库后会自动覆盖这里</small>
      </div>
      <figcaption>${escapeHtml(match.image?.caption || '等待官方社媒进球、对抗或庆祝图片。')}</figcaption>
    </figure>
  `;
}

function expectationBadge(level) {
  if (level === 'aligned') return '符合预期';
  if (level === 'against') return '偏离预期';
  if (level === 'mixed') return '部分偏离';
  return '预期中性';
}

function renderMatchCard(match) {
  const basis = (match.expectation?.reasons || []).length
    ? `判断依据：${match.expectation.reasons.join('、')}`
    : '判断依据：排名、身价或 webhook 补充信号不足，按中性结果展示。';
  return `
    <article class="match-card" id="match-${escapeHtml(match.tagCode)}">
      <header class="match-card-header">
        <div>
          <p class="match-tag">${escapeHtml(match.tag)} | ${escapeHtml(match.competition)}</p>
          <h2>${escapeHtml(match.article.title)}</h2>
        </div>
        <div class="score-box">
          <span>${escapeHtml(match.homeTeam.name)}</span>
          <strong>${escapeHtml(scoreline(match.score))}</strong>
          <span>${escapeHtml(match.awayTeam.name)}</span>
        </div>
      </header>
      <div class="match-grid">
        <section class="match-copy">
          <div class="copy-block">
            <h3>回顾赛果</h3>
            <p>${escapeHtml(match.article.recap)}</p>
          </div>
          <div class="copy-block">
            <h3>复盘</h3>
            <p>${escapeHtml(match.article.review)}</p>
          </div>
          <div class="meta-row">
            <span class="badge badge--${escapeHtml(match.expectation.level)}">${escapeHtml(expectationBadge(match.expectation.level))}</span>
            <span>${escapeHtml(basis)}</span>
          </div>
        </section>
        ${renderImage(match)}
      </div>
    </article>
  `;
}

function renderPage({ title, description, body, dates }) {
  const basePath = normalizeBasePath(process.env.SITE_BASE_PATH);
  const nav = dates.length
    ? `<nav class="date-nav">${dates.map((date) => `<a href="${joinHref(basePath, date.href)}">${escapeHtml(date.label)}</a>`).join('')}</nav>`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="stylesheet" href="${joinHref(basePath, '/assets/styles.css')}">
</head>
<body>
  <div class="page-shell">
    <header class="hero">
      <p class="eyebrow">API -> JSON -> Webhook -> GitHub Pages</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="hero-copy">${escapeHtml(description)}</p>
      ${nav}
    </header>
    <main class="content">
      ${body}
    </main>
  </div>
</body>
</html>`;
}

async function loadReports() {
  const reportFiles = await listJsonFiles(reportsDir);
  const styleGuide = await readJson(resolve(configDir, 'report-style.json'), {});
  const reports = [];

  for (const file of reportFiles) {
    const report = await readJson(resolve(reportsDir, file), null);
    if (!report) continue;
    const enrichments = await readJson(resolve(enrichmentsDir, file), { matches: [] });
    const enrichmentMap = new Map(
      (enrichments?.matches || []).map((item) => [String(item.matchId), item]),
    );
    const matches = (report.matches || []).map((match) => hydrateMatch(match, enrichmentMap.get(match.matchId) || match.enrichment || {}, styleGuide));
    reports.push({
      ...report,
      matches,
    });
  }

  return reports.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

async function buildArchivePage(reports) {
  const basePath = normalizeBasePath(process.env.SITE_BASE_PATH);
  const latest = reports[0];
  const archiveList = reports
    .map((report) => `
      <a class="archive-card" href="${joinHref(basePath, `/reports/${report.date}/`)}">
        <strong>${escapeHtml(formatDateChinese(report.date))}</strong>
        <span>${escapeHtml(`共 ${report.matches.length} 场`)}</span>
      </a>
    `)
    .join('');

  const highlight = latest
    ? `
      <section class="summary-panel">
        <p class="panel-kicker">最新一期</p>
        <h2>${escapeHtml(formatDateChinese(latest.date))}竞彩战报</h2>
        <p>固定展示标题、回顾赛果、配图和复盘。图片由 webhook 补充后会自动重建页面。</p>
        <a class="primary-link" href="${joinHref(basePath, `/reports/${latest.date}/`)}">查看最新日报</a>
      </section>
    `
    : '<p>暂无已生成日报。</p>';

  const body = `
    ${highlight}
    <section class="archive-grid">${archiveList}</section>
  `;

  await writeText(resolve(docsDir, 'index.html'), renderPage({
    title: '竞彩赛果战报站',
    description: '每日自动生成昨日竞彩比赛赛果战报文章，支持 GitHub Pages 部署与 Webhook 图片补充。',
    body,
    dates: reports.slice(0, 8).map((report) => ({
      href: `/reports/${report.date}/`,
      label: report.date,
    })),
  }));
}

async function buildReportPages(reports) {
  const topDates = reports.slice(0, 8).map((report) => ({
    href: `/reports/${report.date}/`,
    label: report.date,
  }));

  for (const report of reports) {
    const outDir = resolve(docsDir, 'reports', report.date);
    await ensureDir(outDir);
    const body = `
      <section class="summary-panel">
        <p class="panel-kicker">生成日期</p>
        <h2>${escapeHtml(formatDateChinese(report.date))}</h2>
        <p>筛选范围为 ${escapeHtml(String(report.filter.minTag).padStart(3, '0'))} 到 ${escapeHtml(String(report.filter.maxTag).padStart(3, '0'))}，共生成 ${escapeHtml(report.matches.length)} 场文章。</p>
      </section>
      <section class="cards">${report.matches.map(renderMatchCard).join('')}</section>
    `;

    await writeText(resolve(outDir, 'index.html'), renderPage({
      title: `${formatDateChinese(report.date)}竞彩赛果战报`,
      description: '每场固定包含标题、回顾赛果、配图和复盘，供 GitHub Pages 直接发布。',
      body,
      dates: topDates,
    }));
  }
}

async function buildAssets() {
  const styles = await readJson(resolve(configDir, 'report-style.json'), {});
  const css = await readJson(resolve(templatesDir, 'site.css.json'), null);
  const finalCss = css?.content || `
:root {
  --bg: #f7f1e5;
  --paper: rgba(255, 251, 243, 0.92);
  --ink: #1f2a37;
  --muted: #6b7280;
  --line: rgba(31, 42, 55, 0.12);
  --accent: #b55233;
  --accent-soft: #f3d6c8;
  --green: #2f855a;
  --amber: #b7791f;
  --rose: #c0564a;
  --shadow: 0 24px 60px rgba(88, 61, 33, 0.12);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(circle at top left, rgba(181, 82, 51, 0.18), transparent 30%),
    radial-gradient(circle at bottom right, rgba(47, 133, 90, 0.14), transparent 28%),
    linear-gradient(180deg, #fbf7ef 0%, #f2e9da 100%);
}

.page-shell {
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px 20px 56px;
}

.hero {
  padding: 28px;
  border: 1px solid var(--line);
  border-radius: 28px;
  background: linear-gradient(135deg, rgba(255,255,255,0.76), rgba(255,247,237,0.92));
  box-shadow: var(--shadow);
}

.eyebrow,
.panel-kicker,
.match-tag {
  margin: 0 0 10px;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}

.hero h1,
.summary-panel h2,
.match-card h2,
.archive-card strong {
  font-family: "Noto Serif SC", "Songti SC", serif;
}

.hero h1 {
  margin: 0;
  font-size: clamp(32px, 5vw, 56px);
  line-height: 1.05;
}

.hero-copy {
  margin: 16px 0 0;
  max-width: 760px;
  color: var(--muted);
  line-height: 1.7;
}

.date-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}

.date-nav a,
.primary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  color: white;
  background: var(--accent);
  text-decoration: none;
}

.content {
  margin-top: 28px;
  display: grid;
  gap: 20px;
}

.summary-panel,
.match-card,
.archive-card {
  border: 1px solid var(--line);
  background: var(--paper);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow);
}

.summary-panel {
  padding: 24px;
  border-radius: 24px;
}

.archive-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.archive-card {
  display: grid;
  gap: 6px;
  padding: 20px;
  border-radius: 22px;
  text-decoration: none;
  color: inherit;
}

.cards {
  display: grid;
  gap: 18px;
}

.match-card {
  padding: 24px;
  border-radius: 26px;
}

.match-card-header {
  display: flex;
  gap: 16px;
  align-items: start;
  justify-content: space-between;
}

.match-card h2 {
  margin: 0;
  font-size: clamp(24px, 3vw, 34px);
  line-height: 1.25;
}

.score-box {
  min-width: 180px;
  padding: 14px 16px;
  border-radius: 20px;
  background: linear-gradient(180deg, #fff, #faeee4);
  text-align: center;
  display: grid;
  gap: 4px;
}

.score-box strong {
  font-size: 28px;
}

.match-grid {
  margin-top: 18px;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.85fr);
  gap: 18px;
}

.copy-block + .copy-block {
  margin-top: 14px;
}

.copy-block h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.copy-block p,
.summary-panel p,
.archive-card span,
.match-image figcaption,
.match-image-meta {
  margin: 0;
  color: var(--muted);
  line-height: 1.8;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
  align-items: center;
  font-size: 14px;
  color: var(--muted);
}

.badge {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
}

.badge--aligned { background: rgba(47, 133, 90, 0.15); color: var(--green); }
.badge--mixed { background: rgba(183, 121, 31, 0.15); color: var(--amber); }
.badge--against { background: rgba(192, 86, 74, 0.15); color: var(--rose); }
.badge--neutral { background: rgba(107, 114, 128, 0.14); color: var(--muted); }

.match-image {
  margin: 0;
  display: grid;
  gap: 10px;
}

.match-image img,
.match-image-placeholder {
  width: 100%;
  min-height: 260px;
  border-radius: 22px;
  border: 1px solid var(--line);
  object-fit: cover;
  background: linear-gradient(160deg, rgba(181, 82, 51, 0.12), rgba(47, 133, 90, 0.12));
}

.match-image-placeholder {
  display: grid;
  place-items: center;
  text-align: center;
  padding: 20px;
}

.match-image-placeholder span {
  font-size: 20px;
  font-family: "Noto Serif SC", "Songti SC", serif;
}

.match-image-placeholder small {
  margin-top: 8px;
  color: var(--muted);
}

.match-image-meta {
  text-decoration: none;
}

@media (max-width: 820px) {
  .match-card-header,
  .match-grid {
    grid-template-columns: 1fr;
    display: grid;
  }

  .score-box {
    width: 100%;
  }
}
`;
  await ensureDir(resolve(docsDir, 'assets'));
  await writeText(resolve(docsDir, 'assets', 'styles.css'), finalCss);
  await writeText(resolve(docsDir, '.nojekyll'), '\n');
  await writeText(resolve(docsDir, 'style-profile.json'), `${JSON.stringify(styles, null, 2)}\n`);
}

async function buildFeed(reports) {
  const latest = reports[0] || null;
  const feed = {
    generatedAt: new Date().toISOString(),
    latestDate: latest?.date || null,
    reports: reports.map((report) => ({
      date: report.date,
      count: report.matches.length,
      href: `/reports/${report.date}/`,
    })),
  };
  await writeText(resolve(docsDir, 'feed.json'), `${JSON.stringify(feed, null, 2)}\n`);
}

async function main() {
  const reports = await loadReports();
  await ensureDir(docsDir);
  await buildAssets();
  await buildArchivePage(reports);
  await buildReportPages(reports);
  await buildFeed(reports);
  process.stdout.write(`built site with ${reports.length} report day(s)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
