import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const notify = process.argv.includes("--notify");

function loadLocalEnv() {
  const envPath = path.join(workspaceRoot, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function chromeEvalJs(js) {
  return `eval(atob('${Buffer.from(String(js), "utf8").toString("base64")}'))`;
}

function getChromeApplicationTargets() {
  return [process.env.MAIZUO_CHROME_APP_PATH || "/Applications/Google Chrome.app", "com.google.Chrome", "Google Chrome"];
}

function executeChromeJs(js) {
  const oneLineJs = String(js)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  const wrappedJs = chromeEvalJs(oneLineJs);
  const script = [
    "(() => {",
    `  const chromeTargets = ${JSON.stringify(getChromeApplicationTargets())};`,
    `  const jsCode = ${JSON.stringify(wrappedJs)};`,
    "  let lastError = null;",
    "  for (const chromeTarget of chromeTargets) {",
    "    try {",
    "      const chrome = Application(chromeTarget);",
    "      for (const browserWindow of chrome.windows()) {",
    "        const tabs = browserWindow.tabs();",
    "        for (let tabIndex = 0; tabIndex < tabs.length; tabIndex += 1) {",
    "          const browserTab = tabs[tabIndex];",
    "          const tabUrl = String(browserTab.url());",
    '          if (tabUrl.includes("maizuo.maitix.com")) {',
    "            browserWindow.activeTabIndex = tabIndex + 1;",
    "            browserWindow.index = 1;",
    "            const jsResult = browserTab.execute({ javascript: jsCode });",
    '            return jsResult == null ? "" : String(jsResult);',
    "          }",
    "        }",
    "      }",
    "    } catch (error) {",
    "      lastError = error;",
    "    }",
    "  }",
    '  throw new Error("No open maizuo.maitix.com tab found in Chrome. Last Chrome lookup error: " + (lastError ? String(lastError) : "none"));',
    "})()",
  ].join("\n");

  return execFileSync("/usr/bin/osascript", ["-l", "JavaScript"], {
    encoding: "utf8",
    input: script,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 20,
  }).trim();
}

function parseChromeJson(raw, context) {
  if (!raw) throw new Error(`Chrome returned empty JavaScript result while ${context}`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Chrome returned invalid JSON while ${context}: ${raw.slice(0, 500)}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJsonViaChrome(url, payload) {
  const jobName = `__maizuoLoginCheck_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  executeChromeJs(`
    window.${jobName} = { status: "running", result: "", error: "" };
    fetch(${JSON.stringify(url)}, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json, text/plain, */*",
        "x-xsrf-token": decodeURIComponent((document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/) || [])[1] || "")
      },
      credentials: "include",
      body: JSON.stringify(${JSON.stringify(payload)})
    }).then(async (response) => {
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Non-JSON response: " + text.slice(0, 300));
      }
      if (!response.ok || json.success === false || json.fail === true) {
        throw new Error(JSON.stringify({ status: response.status, body: json }).slice(0, 1000));
      }
      window.${jobName} = { status: "done", result: JSON.stringify(json), error: "" };
    }).catch((error) => {
      window.${jobName} = {
        status: "error",
        result: "",
        error: String((error && error.message) || error)
      };
    });
    "started";
  `);

  let status = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const raw = executeChromeJs(`JSON.stringify({
      status: (window.${jobName} || {}).status || "missing",
      error: (window.${jobName} || {}).error || "",
      length: ((window.${jobName} || {}).result || "").length
    })`);
    status = parseChromeJson(raw, "polling Maizuo login-check status");
    if (status.status === "done" || status.status === "error") break;
    await sleep(1000);
  }

  if (!status || status.status !== "done") {
    throw new Error(`Chrome API login check failed: ${JSON.stringify(status)}`);
  }

  const rawResult = executeChromeJs(`JSON.stringify((window.${jobName} || {}).result || "")`);
  executeChromeJs(`delete window.${jobName}; "deleted";`);
  return parseChromeJson(parseChromeJson(rawResult, "reading Maizuo login-check result"), "parsing login-check JSON");
}

function flattenProjectEvents(projectTree) {
  let projectCount = 0;
  let eventCount = 0;

  for (const project of projectTree || []) {
    if (!project?.id) continue;
    projectCount += 1;
    for (const event of project.children || []) {
      if (event?.id) eventCount += 1;
    }
  }

  return { projectCount, eventCount };
}

function classifyError(error) {
  const message = String(error && error.message ? error.message : error);
  if (/Allow JavaScript from Apple Events|Executing JavaScript through AppleScript is turned off/i.test(message)) {
    return "chrome_js_error";
  }
  if (/Application can't be found|No open maizuo\.maitix\.com tab|osascript|Apple Events|JXA|Chrome lookup/i.test(message)) {
    return "chrome_bridge_error";
  }
  if (/401|403|登录|login|unauthorized|forbidden|UN_LOGIN_ERROR|登陆超时|重新登陆|needsLogin/i.test(message)) {
    return "login_error";
  }
  return "login_error";
}

function notifyFailure(type, error) {
  if (!notify) return null;
  const notifyPath = path.join(workspaceRoot, "automation", "notify_feishu_sold_out.mjs");
  const result = spawnSync(
    nodeBin,
    [notifyPath],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      input: JSON.stringify({
        type,
        error: String(error && error.message ? error.message : error),
      }),
      stdio: ["pipe", "pipe", "inherit"],
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`notify_feishu_sold_out.mjs failed with exit code ${result.status}`);
  }
  return result.stdout.trim();
}

async function main() {
  loadLocalEnv();
  const ptnrId = Number(process.env.MAIZUO_PTNR_ID || 20021);
  const orgIdDefault = Number(process.env.MAIZUO_ORG_ID_DEFAULT || ptnrId);
  const venueId = Number(process.env.MAIZUO_LOGIN_CHECK_VENUE_ID || 2838020020021);

  const payload = {
    orgIdDefault,
    ptnrId,
    projectTypes: "project",
    showState: "",
    venueIdList: [venueId],
    projectTypeIdList: [],
    eventStateList: [2],
    startTime: "",
    endTime: "",
    repertoireId: [],
    dramaId: [],
    round: [],
    cooperateId: "",
  };

  const response = await postJsonViaChrome("https://bi.maitix.com/rpt/ReportSearchOption/projectEventList", payload);
  const counts = flattenProjectEvents(response.data || []);
  if (!Array.isArray(response.data)) {
    throw new Error("Maizuo login check response missing data array");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        type: "maizuo_login_check",
        checkedAt: new Date().toISOString(),
        venueId,
        ...counts,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const type = classifyError(error);
  let notifyOutput = null;
  try {
    notifyOutput = notifyFailure(type, error);
  } catch (notifyError) {
    console.error(`Failed to send login-check notification: ${notifyError.message || notifyError}`);
  }

  console.error(
    JSON.stringify(
      {
        ok: false,
        type,
        checkedAt: new Date().toISOString(),
        error: error.message || String(error),
        notifyOutput,
      },
      null,
      2,
    ),
  );
  process.exitCode = type === "login_error" ? 20 : 1;
});
