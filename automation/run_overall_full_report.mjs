import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const sendFeishu = process.argv.includes("--feishu") || process.argv.includes("--send-feishu");
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

try {
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
} catch (error) {
  console.error(error.message || error);
  process.exitCode = process.exitCode || 1;
}
