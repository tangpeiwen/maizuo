import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(workspaceRoot, "outputs", "maizuo");

const sourceVenueLabels = ["新天地", "滨港商业中心"];

async function resolveLatestSources() {
  const files = await fs.readdir(outputDir);
  const sources = [];

  for (const venue of sourceVenueLabels) {
    const candidates = await Promise.all(
      files
        .filter((filename) => filename.startsWith("项目整体运营-汇总"))
        .filter((filename) => filename.endsWith(`-${venue}.xlsx`))
        .map(async (filename) => {
          const filePath = path.join(outputDir, filename);
          const stat = await fs.stat(filePath);
          return { venue, filename, mtimeMs: stat.mtimeMs };
        }),
    );

    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    if (!candidates[0]) {
      throw new Error(`Could not find source workbook for ${venue} in ${outputDir}`);
    }
    sources.push({ venue, filename: candidates[0].filename });
  }

  return sources;
}

function asNumber(value) {
  if (typeof value === "number") return value;
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function sellThroughRate(soldTickets, plannedTickets) {
  if (!plannedTickets) return null;
  return (soldTickets || 0) / plannedTickets;
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

function findVenueColumn(values) {
  for (const row of values.slice(0, 8)) {
    const index = row.findIndex((cell) => String(cell || "").trim() === "场馆");
    if (index >= 0) return index;
  }
  return -1;
}

function findGroupedColumn(values, groupHeader, subHeader) {
  const groupRow = values[2] || [];
  const subRow = values[4] || [];

  const groupStart = groupRow.findIndex((cell) => String(cell || "").trim() === groupHeader);
  if (groupStart < 0) {
    throw new Error(`Could not find grouped header: ${groupHeader}`);
  }

  let groupEnd = groupRow.length;
  for (let index = groupStart + 1; index < groupRow.length; index += 1) {
    if (groupRow[index] != null && String(groupRow[index]).trim() !== "") {
      groupEnd = index;
      break;
    }
  }

  for (let index = groupStart; index < groupEnd; index += 1) {
    if (String(subRow[index] || "").trim() === subHeader) return index;
  }

  throw new Error(`Could not find sub header ${subHeader} under ${groupHeader}`);
}

async function readSource({ venue, filename }) {
  const sourcePath = path.join(outputDir, filename);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const sheet = workbook.getWorksheet("导出数据");
  if (!sheet) throw new Error(`Could not find sheet 导出数据 in ${sourcePath}`);
  const values = worksheetToValues(sheet);
  const venueColumn = findVenueColumn(values);
  const plannedTicketsColumn = findGroupedColumn(values, "规划总票房", "票数");
  const soldTicketsColumn = findGroupedColumn(values, "累计已售总票房", "总票数");
  const remainingSellableTicketsColumn = findGroupedColumn(values, "剩余可售总票房", "票数");

  const detailRows = [];
  const totalRows = [];

  for (let rowIndex = 5; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const isTotal = row[0] === "合计";
    const hasProject = row[1] && String(row[1]).trim();
    if (!isTotal && !hasProject) continue;

    const normalized = {
      venue: venueColumn >= 0 && row[venueColumn] ? row[venueColumn] : venue,
      rowType: isTotal ? "合计" : "明细",
      projectName: isTotal ? "合计" : row[1],
      showtime: isTotal ? "" : row[2],
      plannedTickets: asNumber(row[plannedTicketsColumn]),
      soldTickets: asNumber(row[soldTicketsColumn]),
      remainingSellableTickets: asNumber(row[remainingSellableTicketsColumn]),
      sourceFile: filename,
    };

    if (isTotal) totalRows.push(normalized);
    else detailRows.push(normalized);
  }

  return { sourcePath, detailRows, totalRows, rowCount: values.length };
}

function hexToArgb(color) {
  return `FF${String(color).replace(/^#/, "").toUpperCase()}`;
}

function setWorksheetValues(sheet, values) {
  values.forEach((rowValues, rowIndex) => {
    const row = sheet.getRow(rowIndex + 1);
    rowValues.forEach((value, columnIndex) => {
      row.getCell(columnIndex + 1).value = value;
    });
  });
}

function autofitColumns(sheet, values) {
  const columnCount = Math.max(...values.map((row) => row.length));
  for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
    let maxLength = 8;
    for (const row of values) {
      const value = row[columnIndex - 1];
      if (value == null) continue;
      maxLength = Math.max(maxLength, String(value).length);
    }
    sheet.getColumn(columnIndex).width = Math.min(Math.max(maxLength + 2, 10), 48);
  }
}

function writeTable(sheet, headers, rows, options = {}) {
  const values = [headers, ...rows];
  setWorksheetValues(sheet, values);
  for (const columnIndex of options.percentColumnIndexes || []) {
    for (let rowNumber = 2; rowNumber <= rows.length + 1; rowNumber += 1) {
      sheet.getCell(rowNumber, columnIndex + 1).numFmt = "0.00%";
    }
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const headerRow = sheet.getRow(1);
  for (let columnNumber = 1; columnNumber <= headers.length; columnNumber += 1) {
    const cell = headerRow.getCell(columnNumber);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
  }
  autofitColumns(sheet, values);
}

function applyRowFills(sheet, rowFills, columnCount) {
  for (const { rowIndex, color } of rowFills) {
    const row = sheet.getRow(rowIndex + 1);
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      row.getCell(columnNumber).fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(color) } };
    }
  }
}

function logPreview(sheetName, headers, rows, maxRows = 12) {
  console.log(
    JSON.stringify(
      {
        sheetName,
        preview: [headers, ...rows.slice(0, maxRows - 1)],
      },
      null,
      2,
    ),
  );
}

function mergeByVenueAndShowtime(detailObjects) {
  const merged = new Map();

  for (const row of detailObjects) {
    const key = `${row.venue}\u0000${row.showtime}`;
    if (!merged.has(key)) {
      merged.set(key, {
        venue: row.venue,
        showtime: row.showtime,
        projectNames: new Set(),
        plannedTickets: 0,
        soldTickets: 0,
        remainingSellableTickets: 0,
        sourceFiles: new Set(),
        mergedRows: 0,
      });
    }

    const target = merged.get(key);
    target.projectNames.add(row.projectName);
    target.sourceFiles.add(row.sourceFile);
    target.plannedTickets += row.plannedTickets || 0;
    target.soldTickets += row.soldTickets || 0;
    target.remainingSellableTickets += row.remainingSellableTickets || 0;
    target.mergedRows += 1;
  }

  return [...merged.values()].sort((left, right) => {
    const venueCompare = String(left.venue).localeCompare(String(right.venue), "zh-Hans-CN");
    if (venueCompare !== 0) return venueCompare;
    return String(left.showtime).localeCompare(String(right.showtime), "zh-Hans-CN");
  });
}

function groupCountsByVenueAndShowtime(detailObjects) {
  const counts = new Map();
  for (const row of detailObjects) {
    const key = `${row.venue}\u0000${row.showtime}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function sortByVenueShowtimeProject(left, right) {
  const venueCompare = String(left.venue).localeCompare(String(right.venue), "zh-Hans-CN");
  if (venueCompare !== 0) return venueCompare;
  const showtimeCompare = String(left.showtime).localeCompare(String(right.showtime), "zh-Hans-CN");
  if (showtimeCompare !== 0) return showtimeCompare;
  return String(left.projectName).localeCompare(String(right.projectName), "zh-Hans-CN");
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const sources = await resolveLatestSources();
  const sourceResults = [];
  for (const source of sources) {
    sourceResults.push(await readSource(source));
  }

  const detailObjects = sourceResults.flatMap((result) => result.detailRows);
  const totalObjects = sourceResults.flatMap((result) => result.totalRows);
  const showtimeObjects = mergeByVenueAndShowtime(detailObjects);
  const detailGroupCounts = groupCountsByVenueAndShowtime(detailObjects);
  const groupedDetailObjects = [...detailObjects].sort(sortByVenueShowtimeProject);

  const headers = [
    "场馆",
    "场次时间",
    "项目名称",
    "规划总票房票数(D)",
    "累计已售总票房票数(J)",
    "剩余可售总票房票数(U)",
    "合并组行数",
    "来源文件",
  ];

  const detailRows = groupedDetailObjects.map((row) => [
    row.venue,
    row.showtime,
    row.projectName,
    row.plannedTickets,
    row.soldTickets,
    row.remainingSellableTickets,
    detailGroupCounts.get(`${row.venue}\u0000${row.showtime}`) || 1,
    row.sourceFile,
  ]);

  const totalRows = totalObjects.map((row) => [
    row.venue,
    row.projectName,
    row.showtime,
    row.plannedTickets,
    row.soldTickets,
    row.remainingSellableTickets,
    row.sourceFile,
  ]);

  const totalHeaders = [
    "场馆",
    "项目名称",
    "场次时间",
    "规划总票房票数(D)",
    "累计已售总票房票数(J)",
    "剩余可售总票房票数(U)",
    "来源文件",
  ];

  const showtimeHeaders = [
    "场馆",
    "场次时间",
    "项目名称（合并）",
    "规划总票房票数(D)",
    "累计已售总票房票数(J)",
    "商品票售出率",
    "剩余可售总票房票数(U)",
    "合并行数",
    "来源文件",
  ];

  const showtimeRows = showtimeObjects.map((row) => [
    row.venue,
    row.showtime,
    [...row.projectNames].join(" / "),
    row.plannedTickets,
    row.soldTickets,
    sellThroughRate(row.soldTickets, row.plannedTickets),
    row.remainingSellableTickets,
    row.mergedRows,
    [...row.sourceFiles].join(" / "),
  ]);

  const workbook = new ExcelJS.Workbook();
  const detailSheet = workbook.addWorksheet("被合并明细");
  const showtimeSheet = workbook.addWorksheet("场次时间汇总");
  const totalSheet = workbook.addWorksheet("场馆合计");

  writeTable(detailSheet, headers, detailRows);
  writeTable(showtimeSheet, showtimeHeaders, showtimeRows, { percentColumnIndexes: [5] });
  writeTable(totalSheet, totalHeaders, totalRows);

  applyRowFills(
    detailSheet,
    groupedDetailObjects
      .map((row, index) => {
        if (row.remainingSellableTickets === 0) {
          return { rowIndex: index + 1, color: "#FFD6D6" };
        }
        if ((detailGroupCounts.get(`${row.venue}\u0000${row.showtime}`) || 1) > 1) {
          return { rowIndex: index + 1, color: "#DDEBFF" };
        }
        return { rowIndex: index + 1, color: null };
      })
      .filter((row) => row.color),
    headers.length,
  );
  applyRowFills(
    showtimeSheet,
    showtimeObjects
      .map((row, index) => {
        const rate = sellThroughRate(row.soldTickets, row.plannedTickets);
        if (rate != null && rate < 0.2) {
          return { rowIndex: index + 1, color: "#FFD6D6" };
        }
        return { rowIndex: index + 1, color: null };
      })
      .filter((row) => row.color),
    showtimeHeaders.length,
  );

  const outputPath = path.join(outputDir, "项目整体运营-关键票数合并.xlsx");

  logPreview("被合并明细", headers, detailRows);
  logPreview("场次时间汇总", showtimeHeaders, showtimeRows);
  logPreview("场馆合计", totalHeaders, totalRows, 10);

  await workbook.xlsx.writeFile(outputPath);

  const summary = {
    outputPath,
    detailRows: detailRows.length,
    showtimeRows: showtimeRows.length,
    totalRows: totalRows.length,
    sourceRows: sourceResults.map((result) => ({
      sourcePath: result.sourcePath,
      rowCount: result.rowCount,
      detailRows: result.detailRows.length,
      totalRows: result.totalRows.length,
      totals: result.totalRows.map((row) => ({
        venue: row.venue,
        plannedTickets: row.plannedTickets,
        soldTickets: row.soldTickets,
        remainingSellableTickets: row.remainingSellableTickets,
      })),
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
