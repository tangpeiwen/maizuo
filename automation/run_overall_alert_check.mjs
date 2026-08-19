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

function runAutoLogin() {
  const output = runCapture("auto_login_maizuo.mjs");
  if (output.trim()) console.log(output.trim());
  return output.trim();
}

function notifyLoginResult(type, error = null) {
  if (!notify) return;
  const previousExitCode = process.exitCode;
  try {
    const output = runCapture("notify_feishu_sold_out.mjs", [], {
      input: JSON.stringify({
        type,
        source: "麦座整体运营告警任务",
        error: error ? String(error.message || error) : "",
      }),
    });
    if (output.trim()) console.log(output.trim());
  } catch (notifyError) {
    process.exitCode = previousExitCode;
    console.error(`Failed to send login recovery notification: ${notifyError.message || notifyError}`);
  }
}

function runWorkflow() {
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
}

function isLoginExpiredError(error) {
  return process.exitCode === 20 || /exit code 20|UN_LOGIN_ERROR|登陆超时|重新登陆|needsLogin/i.test(error.message || "");
}

function reportNonLoginFailure(error) {
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
  // Login expiry is handled by the automatic recovery branch, which sends its
  // own success/failure result instead of a generic expiry notification.
  if (isLoginExpired) process.exitCode = process.exitCode || 20;
  console.error(error.message || error);
  process.exitCode = process.exitCode || 1;
}

try {
  runWorkflow();
} catch (error) {
  if (!isLoginExpiredError(error)) {
    reportNonLoginFailure(error);
  } else {
    let recoverySucceeded = false;
    try {
      process.exitCode = 0;
      console.log("Maizuo login expired; starting automatic slider login recovery.");
      runAutoLogin();
      recoverySucceeded = true;
      notifyLoginResult("login_recovered");
    } catch (recoveryError) {
      notifyLoginResult("login_recovery_failed", recoveryError);
      console.error(`Automatic Maizuo login recovery failed: ${recoveryError.message || recoveryError}`);
      process.exitCode = process.exitCode || 20;
    }

    if (recoverySucceeded) {
      try {
        process.exitCode = 0;
        runWorkflow();
      } catch (retryError) {
        if (isLoginExpiredError(retryError)) {
          notifyLoginResult("login_recovery_failed", new Error("自动登录完成，但麦座 API 仍报告登录失效"));
        }
        reportNonLoginFailure(retryError);
      }
    }
  }
}
