# 日报

这个目录是一套独立的日报项目，可以直接作为新的 GitHub 仓库使用：

`API -> JSON -> webhook -> GitHub Pages`

核心目标：

1. 每天自动抓取昨日竞彩 `001-025` 的足球赛果。
2. 每场固定生成 `标题 + 回顾赛果 + 配图 + 复盘`。
3. 站点发布到 GitHub Pages。
4. 官方社媒比赛过程图通过 `repository_dispatch` webhook 增量补齐。

## 目录说明

- `scripts/build-daily-reports.mjs`
  按日期抓取懂球帝竞彩赛果和比赛赛况，生成日报 JSON。
- `scripts/merge-dispatch-payload.mjs`
  合并 webhook 回传的图片、公众预期、备注等增强字段。
- `scripts/build-site.mjs`
  把 `data/reports/*.json` 和 `data/enrichments/*.json` 生成成静态网站。
- `data/reports/YYYY-MM-DD.json`
  标准化后的日报数据。
- `data/enrichments/YYYY-MM-DD.json`
  webhook 增量补图和补充判断。
- `.github/workflows/daily-reports.yml`
  每天自动抓昨日战报并部署。
- `.github/workflows/report-enrichment.yml`
  收到 `repository_dispatch` 后合并图片并重建站点。

## 本地运行

如果你本机已经装了 Node 18+：

```bash
node scripts/build-daily-reports.mjs --date 2026-09-02
node scripts/build-site.mjs
```

如果要用 Codex 工作区内置 Node：

```bash
/Users/demo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/demo/Documents/彩经日报/日报/scripts/build-daily-reports.mjs --date 2026-09-02
/Users/demo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/demo/Documents/彩经日报/日报/scripts/build-site.mjs
```

默认会输出：

- `data/reports/2026-09-02.json`
- `docs/index.html`
- `docs/reports/2026-09-02/index.html`

## 环境变量

- `DQD_SCHEDULE_ENDPOINT`
  默认为 `https://api.dongqiudi.com/data/tab/new/lottery`
- `DQD_SITUATION_ENDPOINT`
  默认为 `https://api.dongqiudi.com/mobile/match/situation`
- `DQD_AUTHORIZATION`
  如果你的接口需要鉴权可补上
- `DQD_COOKIE`
  如果你的接口需要 Cookie 可补上
- `SITE_BASE_PATH`
  GitHub Pages 项目库路径前缀，例如仓库名是 `jingcai-report` 时可设为 `/jingcai-report`

## webhook 设计

GitHub Pages 本身不能直接接收 webhook，所以这里用 GitHub 官方的 `repository_dispatch` 事件做入站。

你可以从外部图片采集器、浏览器自动化脚本、或者单独的社媒抓图服务，把官方社媒图片推回仓库。

示例 payload 见：

- [data/config/pipeline.workflow.json](/Users/demo/Documents/彩经日报/日报/data/config/pipeline.workflow.json)
- [data/config/repository-dispatch.example.json](/Users/demo/Documents/彩经日报/日报/data/config/repository-dispatch.example.json)
- [data/config/social-sources.example.json](/Users/demo/Documents/彩经日报/日报/data/config/social-sources.example.json)

### `repository_dispatch` 请求体示例

```json
{
  "event_type": "jingcai_social_images",
  "client_payload": {
    "date": "2026-09-02",
    "matches": [
      {
        "matchId": "54479852",
        "image": {
          "url": "https://cdn.example.com/cerezo-goal.jpg",
          "source": "x",
          "postUrl": "https://x.com/example/status/123",
          "alt": "大阪樱花进球庆祝",
          "caption": "大阪樱花官方账号发布的进球庆祝图"
        },
        "expectation": {
          "publicLean": "away",
          "note": "赛前更多声音看好柏太阳神延续状态，但大阪樱花把主场效率打成了结果。"
        }
      }
    ]
  }
}
```

## 图片策略

图片位已经内建在页面结构里，但真正满足你要求的“官方社媒比赛过程图”建议走单独 webhook 补图链路，原因很简单：

1. 各平台公开抓取限制不同。
2. X、Instagram、微博、俱乐部官网的授权和反爬规则不统一。
3. GitHub Actions 更适合接收已筛好的图片 URL，而不是直接承担所有社媒登录和浏览器状态。

所以这里的最佳实践是：

1. 每日定时任务先把文章和图片占位生成出来。
2. 你的外部抓图器去官方社媒找“进球、庆祝、激烈对抗、扑救”等过程图。
3. 抓到后发 `repository_dispatch`。
4. 仓库自动补图并重建 Pages。

## 已固化的 RAG 风格

你刚给的这组风格已经写进生成逻辑里，重点保留：

- 先交代比分和比赛走势。
- 用控球、射门、射正、角球、绝佳机会解释赛果。
- 要判断赛果是否符合大众预期。
- 复盘重点写先手、效率、禁区攻势、后程稳定性。

## GitHub 部署

1. 把仓库推到 GitHub。
2. 打开仓库 `Settings -> Pages`。
3. Source 选择 `GitHub Actions`。
4. 保证默认分支允许 workflow push 回内容。
5. 如果接口需要鉴权，把 `DQD_AUTHORIZATION` 或 `DQD_COOKIE` 配到仓库 `Secrets and variables -> Actions`。

## 当前限制

这版已经把站点、JSON 产线、每日自动化和 webhook 回填打通了。

还没有在仓库里直接内建“登录各社媒并抓图”的 headless 采集器，因为这部分更适合你单独接一个外部 worker 或本地浏览器自动化任务。这样图片链路更稳，也更符合 GitHub Pages 的静态发布方式。
