import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const sendFeishu = process.argv.includes("--feishu") || process.argv.includes("--send-feishu");
const notifyLoginFlag = process.argv.includes("--notify");
const finalWorkbookPath = path.join(workspaceRoot, "outputs", "maizuo", "项目整体运营-关键票数合并.xlsx");

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

function loginNotificationsEnabled() {
  return (
    notifyLoginFlag ||
    sendFeishu ||
    Boolean(process.env.FEISHU_WEBHOOK_URL || process.env.LARK_WEBHOOK_URL)
  );
}

function notifyLoginResult(type, error = null) {
  if (!loginNotificationsEnabled()) return;
  const scriptPath = path.join(workspaceRoot, "automation", "notify_feishu_sold_out.mjs");
  const result = spawnSync(nodeBin, [scriptPath], {
    cwd: workspaceRoot,
    encoding: "utf8",
    input: JSON.stringify({
      type,
      source: "麦座整体运营完整报表任务",
      error: error ? String(error.message || error) : "",
    }),
    stdio: ["pipe", "pipe", "inherit"],
  });
  if (result.error) {
    console.error(`Failed to send login recovery notification: ${result.error.message || result.error}`);
    return;
  }
  if (result.status !== 0) {
    console.error(`Failed to send login recovery notification: notifier exited with code ${result.status}`);
    return;
  }
  if (result.stdout.trim()) console.log(result.stdout.trim());
}

function runWorkflow() {
  loadLocalEnv();
  console.log("[1/3] Fetch Maizuo overall operate data");
  run("fetch_overall_operate_report_api.mjs");
  console.log("[2/3] Merge workbook");
  run("merge_overall_operate_key_tickets.mjs");
  if (sendFeishu) {
    console.log("[3/3] Send workbook to Feishu");
    run("send_feishu_file.mjs", [finalWorkbookPath]);
  }
  console.log("Overall full report completed.");
}

try {
  runWorkflow();
} catch (error) {
  const isLoginExpired =
    process.exitCode === 20 || /exit code 20|UN_LOGIN_ERROR|登陆超时|重新登陆|needsLogin/i.test(error.message || "");
  if (!isLoginExpired) {
    console.error(error.message || error);
    process.exitCode = process.exitCode || 1;
  } else {
    let recoverySucceeded = false;
    try {
      process.exitCode = 0;
      console.log("Maizuo login expired; starting automatic slider login recovery.");
      run("auto_login_maizuo.mjs");
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
        const retryStillLoggedOut =
          process.exitCode === 20 ||
          /exit code 20|UN_LOGIN_ERROR|登陆超时|重新登陆|needsLogin/i.test(retryError.message || "");
        if (retryStillLoggedOut) {
          notifyLoginResult("login_recovery_failed", new Error("自动登录完成，但麦座 API 仍报告登录失效"));
        }
        console.error(retryError.message || retryError);
        process.exitCode = process.exitCode || 1;
      }
    }
  }
}
