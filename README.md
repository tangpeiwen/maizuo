# Maizuo SpicyComedy Automation

Local automation for exporting and monitoring Maizuo reports for SpicyComedy venues.

## What It Does

- Fetches Maizuo `整体运营表` data for:
  - `新天地`
  - `滨港商业中心`
- Builds the merged workbook:
  - `场次时间汇总`
  - `被合并明细`
  - `场馆合计`
- Sends sold-out text alerts to Feishu.
- Optionally sends the final merged Excel workbook to a Feishu group.

## Prerequisites

- Use the canonical workspace:

```bash
/Users/aaaa/Documents/GitHub/maizuo
```

- Keep normal Google Chrome logged into Maizuo with at least one `maizuo.maitix.com` tab open.
- Enable Chrome menu:

```text
View > Developer > Allow JavaScript from Apple Events
```

## Commands

Full export and merge:

```bash
npm run maizuo:overall:full
```

Full export, merge, and send final Excel to Feishu:

```bash
FEISHU_APP_ID=... FEISHU_APP_SECRET=... FEISHU_CHAT_ID=... npm run maizuo:overall:full:feishu
```

Sold-out alert dry-run:

```bash
npm run maizuo:overall:alert
```

Sold-out alert with Feishu notification and dedupe state commit:

```bash
FEISHU_WEBHOOK_URL=... FEISHU_BOT_SECRET=... npm run maizuo:overall:alert:commit
```

## Generated Files

Generated Excel files and runtime state are intentionally ignored by git:

- `outputs/`
- `state/`

Copy `.env.example` to `.env` for local secrets if needed. Never commit real credentials.
