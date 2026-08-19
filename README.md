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
- When the Chrome Maizuo session expires, uses PyAutoGUI to drag the login
  slider, clicks `登录`, and retries the interrupted monitoring task once.
- For notification-enabled tasks, sends a Feishu message after successful
  automatic re-login; if recovery fails, asks for a manual Chrome login.

## Prerequisites

- Use the canonical workspace:

```bash
/Users/aaaa/Documents/GitHub/maizuo
```

- Keep normal Google Chrome logged into Maizuo with at least one `maizuo.maitix.com` tab open.
- Install PyAutoGUI for the system Python used by the automation and allow that
  Python process to control the Mac in **System Settings → Privacy & Security → Accessibility**:

```bash
/usr/bin/python3 -m pip install --user pyautogui
```

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

Run the automatic login recovery directly:

```bash
npm run maizuo:login:auto
```

The login-status check now attempts the same automatic recovery before it
fails. Its `--notify` variant sends the automatic-login result to Feishu:

- Success: `检测到登录失效，已重新自动登录。`
- Failure: `麦座登录失效，自动登录失败` and a request to log in manually.

Sold-out alert with Feishu notification and dedupe state commit:

```bash
FEISHU_WEBHOOK_URL=... FEISHU_BOT_SECRET=... npm run maizuo:overall:alert:commit
```

## Generated Files

Generated Excel files and runtime state are intentionally ignored by git:

- `outputs/`
- `state/`

Copy `.env.example` to `.env` for local secrets if needed. Never commit real credentials.
