import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const workspaceRoot = "/Users/aaaa/Documents/GitHub/maizuo";
const outputDir = path.join(workspaceRoot, "outputs", "maizuo");
const parserPath = path.join(workspaceRoot, "automation", "parse_maizuo_daily_report.py");

function normalizeWeekday(name) {
  return name || "";
}

async function findLatestDailyReport() {
  const entries = await fs.readdir(outputDir);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.endsWith(".xlsx") || !entry.includes("项目销售日报表")) {
      continue;
    }
    const absolutePath = path.join(outputDir, entry);
    const stat = await fs.stat(absolutePath);
    candidates.push({ absolutePath, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (candidates.length === 0) {
    throw new Error("No exported 项目销售日报表 xlsx file was found.");
  }
  return candidates[0].absolutePath;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const sourceWorkbookPath = await findLatestDailyReport();
  const parsedJsonPath = path.join(outputDir, "maizuo-showtime-subtotals.json");

  const parseResult = spawnSync("python", [parserPath, sourceWorkbookPath, parsedJsonPath], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  if (parseResult.status !== 0) {
    throw new Error(parseResult.stderr || parseResult.stdout || "Failed to parse the daily report xlsx.");
  }
  process.stdout.write(parseResult.stdout);

  const rows = JSON.parse(await fs.readFile(parsedJsonPath, "utf8"));
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("场次小计");

  const headers = [["日期", "星期", "时间", "类型（场次名称）", "场地", "门票小计"]];
  sheet.getRange("A1:F1").values = headers;

  const values = rows.map((row) => [
    row.date,
    normalizeWeekday(row.weekday),
    row.time,
    row.type,
    row.venue,
    row.subtotal_tickets,
  ]);

  if (values.length > 0) {
    sheet.getRange(`A2:F${values.length + 1}`).values = values;
  }

  sheet.freezePanes.freezeRows(1);
  sheet.getRange("A1:F1").format.fill.color = "#17324D";
  sheet.getRange("A1:F1").format.font.color = "#FFFFFF";
  sheet.getRange("A1:F1").format.font.bold = true;
  sheet.getRange("A:F").format.autofitColumns();

  const check = await workbook.inspect({
    kind: "table",
    range: `场次小计!A1:F${Math.max(values.length + 1, 10)}`,
    include: "values",
    tableMaxRows: 20,
    tableMaxCols: 6,
  });
  console.log(check.ndjson);

  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 100 },
    summary: "final formula error scan",
  });
  console.log(errors.ndjson);

  await workbook.render({
    sheetName: "场次小计",
    range: `A1:F${Math.max(values.length + 1, 15)}`,
    scale: 1.5,
  });

  const outputPath = path.join(outputDir, "maizuo-showtime-subtotals.xlsx");
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  console.log(`Built subtotal workbook: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
