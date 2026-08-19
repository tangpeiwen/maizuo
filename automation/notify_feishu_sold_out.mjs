import crypto from "node:crypto";

const webhookUrl = process.env.FEISHU_WEBHOOK_URL || process.env.LARK_WEBHOOK_URL || "";
const secret = process.env.FEISHU_BOT_SECRET || process.env.LARK_BOT_SECRET || "";
const preview = process.argv.includes("--preview");

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function buildSign(timestamp) {
  if (!secret) return {};
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac("sha256", stringToSign).update("").digest("base64");
  return { timestamp, sign };
}

function formatAlert(alert) {
  return [
    `场馆：${alert.venue}`,
    `场次：${alert.showtime}`,
    `项目：${alert.projectName}`,
    `票数：${alert.soldTickets}/${alert.plannedTickets}`,
    `剩余可售：${alert.remainingSellableTickets}`,
  ].join("\n");
}

function buildMessage(report) {
  if (report.type === "login_recovered") {
    return [
      "麦座登录状态提醒",
      `时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
      "检测到登录失效，已重新自动登录。",
      report.source ? `任务：${report.source}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (report.type === "login_recovery_failed") {
    return [
      "麦座登录失效，自动登录失败",
      `时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
      report.source ? `任务：${report.source}` : "",
      report.error ? `错误：${report.error}` : "",
      "",
      "请在 Chrome 中手动登录麦座，并保持一个 maizuo.maitix.com 标签页打开。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (report.type === "chrome_js_error") {
    return [
      "麦座自动化预警：Chrome 未允许 AppleScript 执行 JavaScript",
      `时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
      report.error ? `错误：${report.error}` : "",
      "",
      "请在 Chrome 菜单打开：View > Developer > Allow JavaScript from Apple Events。",
      "打开后保持一个 maizuo.maitix.com 标签页，再重跑任务。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (report.type === "chrome_bridge_error") {
    return [
      "麦座自动化预警：无法连接当前 Chrome 麦座页面",
      `时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
      report.error ? `错误：${report.error}` : "",
      "",
      "请确认普通 Chrome 正在运行，并保持一个 maizuo.maitix.com 标签页打开。",
      "同时确认 Chrome 菜单 View > Developer > Allow JavaScript from Apple Events 已开启。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const alerts = report.newAlerts || [];
  const lines = [
    `麦座售罄预警：新增 ${alerts.length} 条`,
    `过滤：${report.dateFilter || "未设置"}`,
    `文件：${report.workbookPath || ""}`,
    "",
    ...alerts.flatMap((alert, index) => [`${index + 1}.`, formatAlert(alert), ""]),
  ];

  return lines.join("\n").trim();
}

const input = await readStdin();
const report = JSON.parse(input);

if (preview) {
  console.log(JSON.stringify({ ok: true, preview: true, type: report.type || "sold_out", text: buildMessage(report) }, null, 2));
  process.exit(0);
}

if (
  !["login_recovered", "login_recovery_failed", "chrome_js_error", "chrome_bridge_error"].includes(report.type) &&
  (!report.newAlerts || report.newAlerts.length === 0)
) {
  console.log(JSON.stringify({ ok: true, sent: false, reason: "no-new-alerts" }, null, 2));
  process.exit(0);
}

if (!webhookUrl) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        sent: false,
        reason: "missing FEISHU_WEBHOOK_URL",
        type: report.type || "sold_out",
        newAlertCount: report.newAlerts ? report.newAlerts.length : 0,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const timestamp = Math.floor(Date.now() / 1000).toString();
const payload = {
  ...buildSign(timestamp),
  msg_type: "text",
  content: {
    text: buildMessage(report),
  },
};

const response = await fetch(webhookUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify(payload),
});

const text = await response.text();
let json = null;
try {
  json = JSON.parse(text);
} catch {
  // Keep the raw response for error reporting.
}

if (!response.ok || (json && json.code !== 0 && json.StatusCode !== 0)) {
  throw new Error(`Feishu webhook failed: HTTP ${response.status} ${text.slice(0, 1000)}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      sent: true,
      type: report.type || "sold_out",
      newAlertCount: report.newAlerts ? report.newAlerts.length : 0,
      response: json || text,
    },
    null,
    2,
  ),
);
