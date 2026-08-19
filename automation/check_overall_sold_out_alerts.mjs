import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(workspaceRoot, "outputs", "maizuo");
const stateDir = path.join(workspaceRoot, "state");
const workbookPath = path.join(outputDir, "项目整体运营-关键票数合并.xlsx");
const statePath = path.join(stateDir, "overall-operate-alerts.json");

const commit = process.argv.includes("--commit");
const includeAllDates = process.argv.includes("--all-dates");
const alertFromDate = process.env.MAIZUO_ALERT_FROM_DATE || todayInShanghai();
const alertVenues = (process.env.MAIZUO_ALERT_VENUES || "新天地")
  .split(",")
  .map(normalize)
  .filter(Boolean);
const remainingTicketThreshold = Number(process.env.MAIZUO_ALERT_REMAINING_THRESHOLD || 2);

if (!Number.isFinite(remainingTicketThreshold) || remainingTicketThreshold < 0) {
  throw new Error(`Invalid MAIZUO_ALERT_REMAINING_THRESHOLD: ${process.env.MAIZUO_ALERT_REMAINING_THRESHOLD}`);
}

function normalize(value) {
  return String(value ?? "").trim();
}

function todayInShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function extractDate(value) {
  const match = normalize(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { alertedKeys: [] };
    throw error;
  }
}

async function saveState(state) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

function cellToValue(value) {
  if (value && typeof value === "object") {
    if ("result" in value) return value.result;
    if ("text" in value) return value.text;
    if ("richText" in value) return value.richText.map((part) => part.text || "").join("");
  }
  return value;
}

function worksheetToValues(sheet) {
  const values = [];
  const columnCount = sheet.columnCount;
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const rowValues = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      rowValues.push(cellToValue(row.getCell(columnNumber).value));
    }
    values.push(rowValues);
  }
  return values;
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);
const sheet = workbook.getWorksheet("被合并明细");
if (!sheet) throw new Error(`Could not find sheet 被合并明细 in ${workbookPath}`);
const values = worksheetToValues(sheet);
const headers = values[0].map(normalize);

const venueIndex = headers.indexOf("场馆");
const showtimeIndex = headers.indexOf("场次时间");
const projectIndex = headers.indexOf("项目名称");
const remainingIndex = headers.indexOf("剩余可售总票房票数(U)");
const plannedIndex = headers.indexOf("规划总票房票数(D)");
const soldIndex = headers.indexOf("累计已售总票房票数(J)");

for (const [name, index] of Object.entries({
  场馆: venueIndex,
  场次时间: showtimeIndex,
  项目名称: projectIndex,
  "剩余可售总票房票数(U)": remainingIndex,
})) {
  if (index < 0) throw new Error(`Missing required column: ${name}`);
}

const soldOutRows = [];
for (const row of values.slice(1)) {
  const venue = normalize(row[venueIndex]);
  if (alertVenues.length > 0 && !alertVenues.includes(venue)) continue;

  const remainingRaw = normalize(row[remainingIndex]);
  const remaining = Number(remainingRaw);
  if (!remainingRaw || !Number.isFinite(remaining) || remaining > remainingTicketThreshold) continue;
  const showDate = extractDate(row[showtimeIndex]);
  if (!includeAllDates && (!showDate || showDate < alertFromDate)) continue;

  const alert = {
    key: [row[venueIndex], row[showtimeIndex], row[projectIndex]].map(normalize).join(" | "),
    venue: row[venueIndex],
    showtime: row[showtimeIndex],
    projectName: row[projectIndex],
    plannedTickets: plannedIndex >= 0 ? row[plannedIndex] : null,
    soldTickets: soldIndex >= 0 ? row[soldIndex] : null,
    remainingSellableTickets: row[remainingIndex],
  };
  soldOutRows.push(alert);
}

const state = await loadState();
const alertedKeys = new Set(state.alertedKeys || []);
const newAlerts = soldOutRows.filter((row) => !alertedKeys.has(row.key));

if (commit && newAlerts.length > 0) {
  for (const alert of newAlerts) alertedKeys.add(alert.key);
  await saveState({
    updatedAt: new Date().toISOString(),
    alertedKeys: [...alertedKeys].sort(),
  });
}

console.log(
  JSON.stringify(
    {
      mode: commit ? "commit" : "dry-run",
      workbookPath,
      statePath,
      dateFilter: includeAllDates ? "all-dates" : `showtime >= ${alertFromDate}`,
      venueFilter: alertVenues.length > 0 ? alertVenues : "all-venues",
      remainingTicketThreshold,
      alertCondition: `剩余可售总票房票数(U) <= ${remainingTicketThreshold}`,
      soldOutCount: soldOutRows.length,
      newAlertCount: newAlerts.length,
      newAlerts,
    },
    null,
    2,
  ),
);
