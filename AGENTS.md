# AGENTS.md

This repository contains local automation for Maizuo report exports and processing.

## Canonical Workspace

Use this repo as the workspace:

```bash
/Users/aaaa/Documents/GitHub/maizuo
```

Do not use the old `personalwebsite` path for Maizuo automation.

## Current Overall Operations Workflow

The supported Maizuo `整体运营表` path is:

1. Use an already logged-in normal Google Chrome session.
2. Keep at least one `maizuo.maitix.com` tab open.
3. Enable Chrome menu `View > Developer > Allow JavaScript from Apple Events`.
4. Run API requests inside that Chrome tab with `fetch(..., { credentials: "include" })` via `osascript -l JavaScript` (JXA).
5. Write the two venue source workbooks.
6. Merge and scan the final workbook.

This workflow intentionally does not use:

- CDP / `remote-debugging-port=9222`
- a dedicated `.chrome-profile`
- Playwright login/session-state reuse
- saved Maizuo cookies on disk

## Commands

Run from the repo root.

Full overall operations export and merge:

```bash
npm run maizuo:overall:full
```

Full overall operations export, merge, and send the final Excel workbook to Feishu:

```bash
FEISHU_APP_ID=... FEISHU_APP_SECRET=... FEISHU_CHAT_ID=... npm run maizuo:overall:full:feishu
```

Sold-out alert dry-run:

```bash
npm run maizuo:overall:alert
```

Sold-out alert with Feishu notification attempt:

```bash
npm run maizuo:overall:alert:notify
```

Sold-out alert with notification and state commit:

```bash
npm run maizuo:overall:alert:commit
```

Feishu notification requires these environment variables:

```bash
FEISHU_WEBHOOK_URL=...
FEISHU_BOT_SECRET=...
```

Sending the final Excel workbook as a Feishu file requires app credentials instead of the incoming webhook:

```bash
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_CHAT_ID=...
```

## Important Files

- `automation/fetch_overall_operate_report_api.mjs` fetches Maizuo overall operations data for 新天地 and 滨港商业中心 through the logged-in Chrome tab.
- `automation/merge_overall_operate_key_tickets.mjs` builds the final merged workbook.
- `automation/check_overall_sold_out_alerts.mjs` scans `被合并明细` for rows where `剩余可售总票房票数(U) === 0`.
- `automation/notify_feishu_sold_out.mjs` sends Feishu webhook messages.
- `automation/send_feishu_file.mjs` uploads the final merged workbook and sends it to a Feishu group as a file message.
- `automation/run_overall_full_report.mjs` runs fetch + merge.
- `automation/run_overall_alert_check.mjs` runs fetch + merge + scan + optional notify/commit.
- `automation/maizuo-build-subtotals.mjs` and `automation/parse_maizuo_daily_report.py` are for the older `项目销售日报表` subtotal workbook flow.

## Outputs

Generated files go to:

```bash
/Users/aaaa/Documents/GitHub/maizuo/outputs/maizuo
```

The final merged workbook is:

```bash
/Users/aaaa/Documents/GitHub/maizuo/outputs/maizuo/项目整体运营-关键票数合并.xlsx
```

Alert dedupe state is stored at:

```bash
/Users/aaaa/Documents/GitHub/maizuo/state/overall-operate-alerts.json
```

## Failure Modes

- If the JXA Chrome bridge cannot find a Maizuo tab, open `https://maizuo.maitix.com/boss/` in normal Chrome.
- If Chrome says JavaScript through Apple Events is disabled, enable `View > Developer > Allow JavaScript from Apple Events`.
- If the Maizuo session is expired, log in manually in Chrome, then rerun the command.
