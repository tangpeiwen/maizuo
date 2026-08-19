import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const commit = process.argv.includes("--commit");
const notify = process.argv.includes("--notify") || commit;

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

function run(script, args = []) {
  const scriptPath = path.join(workspaceRoot, "automation", script);
  const result = spawnSync(nodeBin, [scriptPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(`${script} failed with exit code ${result.status}`);
  }
}

function notifyLoginExpired(error) {
  if (!notify) return;
  const report = {
    type: "login_error",
    error: String(error && error.message ? error.message : error),
  };
  const notifyOutput = runCapture("notify_feishu_sold_out.mjs", [], {
    input: JSON.stringify(report),
  });
  console.log(notifyOutput.trim());
}

function notifyChromeJsDisabled(error) {
  if (!notify) return;
  const report = {
    type: "chrome_js_error",
    error: String(error && error.message ? error.message : error),
  };
  const notifyOutput = runCapture("notify_feishu_sold_out.mjs", [], {
    input: JSON.stringify(report),
  });
  console.log(notifyOutput.trim());
}

function notifyChromeBridgeError(error) {
  if (!notify) return;
  const report = {
    type: "chrome_bridge_error",
    error: String(error && error.message ? error.message : error),
  };
  const notifyOutput = runCapture("notify_feishu_sold_out.mjs", [], {
    input: JSON.stringify(report),
  });
  console.log(notifyOutput.trim());
}

function runCapture(script, args = [], options = {}) {
  const scriptPath = path.join(workspaceRoot, "automation", script);
  const result = spawnSync(nodeBin, [scriptPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    input: options.input,
    stdio: ["pipe", "pipe", "inherit"],
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(`${script} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

try {
  loadLocalEnv();
  run("fetch_overall_operate_report_api.mjs");
  run("merge_overall_operate_key_tickets.mjs");
  const scanOutput = runCapture("check_overall_sold_out_alerts.mjs");
  console.log(scanOutput.trim());

  if (notify) {
    const notifyOutput = runCapture("notify_feishu_sold_out.mjs", [], { input: scanOutput });
    console.log(notifyOutput.trim());

    const notifyResult = JSON.parse(notifyOutput);
    if (commit && notifyResult.sent) {
      const commitOutput = runCapture("check_overall_sold_out_alerts.mjs", ["--commit"]);
      console.log(commitOutput.trim());
    }
  }

  console.log(`Overall alert check completed (${commit ? "commit" : "dry-run"}${notify ? ", notify" : ""}).`);
} catch (error) {
  const isLoginExpired =
    process.exitCode === 20 || /exit code 20|UN_LOGIN_ERROR|登陆超时|重新登陆|needsLogin/i.test(error.message || "");
  const isChromeJsDisabled = /Allow JavaScript from Apple Events|Executing JavaScript through AppleScript is turned off/i.test(
    error.message || "",
  );
  const isChromeBridgeError =
    !isChromeJsDisabled &&
    /Application can't be found|No open maizuo\.maitix\.com tab|osascript|Apple Events|JXA|Chrome lookup/i.test(
      error.message || "",
    );
  if (isChromeJsDisabled) {
    try {
      notifyChromeJsDisabled(error);
    } catch (notifyError) {
      console.error(`Failed to send Chrome-JS-disabled notification: ${notifyError.message || notifyError}`);
    }
  }
  if (isChromeBridgeError) {
    try {
      notifyChromeBridgeError(error);
    } catch (notifyError) {
      console.error(`Failed to send Chrome-bridge notification: ${notifyError.message || notifyError}`);
    }
  }
  if (isLoginExpired) {
    try {
      notifyLoginExpired(error);
    } catch (notifyError) {
      console.error(`Failed to send login-expired notification: ${notifyError.message || notifyError}`);
    }
  }
  console.error(error.message || error);
  process.exitCode = process.exitCode || 1;
}
