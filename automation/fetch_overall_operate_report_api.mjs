import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const defaultWorkspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = process.env.MAIZUO_WORKSPACE_ROOT || defaultWorkspaceRoot;
const outputDir = process.env.MAIZUO_OUTPUT_DIR || path.join(workspaceRoot, "outputs", "maizuo");
const ptnrId = Number(process.env.MAIZUO_PTNR_ID || 20021);
const orgIdDefault = Number(process.env.MAIZUO_ORG_ID_DEFAULT || ptnrId);
const chromeApplicationTargets = [
  process.env.MAIZUO_CHROME_APP_PATH || "/Applications/Google Chrome.app",
  "com.google.Chrome",
  "Google Chrome",
];

const venues = [
  {
    label: "新天地",
    venueId: 2838020020021,
  },
  {
    label: "滨港商业中心",
    venueId: 3172002020021,
  },
];

function timestamp() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
}

function chromeEvalJs(js) {
  return `eval(atob('${Buffer.from(String(js), "utf8").toString("base64")}'))`;
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
    `  const chromeTargets = ${JSON.stringify(chromeApplicationTargets)};`,
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
  const jobName = `__maizuoApiJob_${Date.now()}_${Math.random().toString(36).slice(2)}`;

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
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const raw = executeChromeJs(`JSON.stringify({
      status: (window.${jobName} || {}).status || "missing",
      error: (window.${jobName} || {}).error || "",
      length: ((window.${jobName} || {}).result || "").length
    })`);
    status = parseChromeJson(raw, "polling Maizuo API job status");
    if (status.status === "done" || status.status === "error") break;
    await sleep(1000);
  }

  if (!status || status.status !== "done") {
    throw new Error(`Chrome API fetch failed: ${JSON.stringify(status)}`);
  }

  let result = "";
  const chunkSize = 16000;
  for (let offset = 0; offset < status.length; offset += chunkSize) {
    const raw = executeChromeJs(
      `JSON.stringify(((window.${jobName} || {}).result || "").slice(${offset}, ${offset + chunkSize}))`,
    );
    result += parseChromeJson(raw, "reading Maizuo API result chunk");
  }

  executeChromeJs(`delete window.${jobName}; "deleted";`);
  return parseChromeJson(result, "parsing Maizuo API final result");
}

function flattenProjectEvents(projectTree) {
  const projectIds = [];
  const eventIds = [];

  for (const project of projectTree || []) {
    if (!project?.id) continue;
    projectIds.push(String(project.id));
    for (const event of project.children || []) {
      if (event?.id) eventIds.push(String(event.id));
    }
  }

  return {
    projectIds: [...new Set(projectIds)],
    eventIds: [...new Set(eventIds)],
  };
}

async function fetchVenue(venue) {
  const projectPayload = {
    orgIdDefault,
    ptnrId,
    projectTypes: "project",
    showState: "",
    venueIdList: [venue.venueId],
    projectTypeIdList: [],
    eventStateList: [2],
    startTime: "",
    endTime: "",
    repertoireId: [],
    dramaId: [],
    round: [],
    cooperateId: "",
  };
  const projectResponse = await postJsonViaChrome(
    "https://bi.maitix.com/rpt/ReportSearchOption/projectEventList",
    projectPayload,
  );
  const { projectIds, eventIds } = flattenProjectEvents(projectResponse.data || []);

  if (projectIds.length === 0 || eventIds.length === 0) {
    throw new Error(
      `No project/event ids returned for ${venue.label}. projectIds=${projectIds.length}, eventIds=${eventIds.length}`,
    );
  }

  const summaryResponse = await postJsonViaChrome("https://bi.maitix.com/rpt/projectWholeOperate/summary/query", {
    orderStartTime: "",
    orderEndTime: "",
    payStartTime: "",
    payEndTime: "",
    queryPtnrId: ptnrId,
    eventIds,
    projectIds,
  });

  const rows = summaryResponse?.data?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No summary table returned for ${venue.label}`);
  }

  return {
    venue,
    projectIds,
    eventIds,
    rows,
  };
}

function withVenueColumn(rawRows, venueLabel) {
  return rawRows.map((row, index) => {
    const normalized = Array.isArray(row) ? [...row] : [];
    if (index === 0 || index === 2) normalized.push("场馆");
    else if (index >= 3) normalized.push(venueLabel);
    else normalized.push("");
    return normalized;
  });
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

async function writeSourceWorkbook({ venueLabel, rows, runStamp }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("导出数据");
  const values = [["项目整体运营-汇总"], [], ...withVenueColumn(rows, venueLabel)];
  const columnCount = Math.max(...values.map((row) => row.length));
  const paddedValues = values.map((row) => {
    const padded = [...row];
    while (padded.length < columnCount) padded.push("");
    return padded;
  });

  setWorksheetValues(sheet, paddedValues);
  sheet.views = [{ state: "frozen", ySplit: 5 }];
  autofitColumns(sheet, paddedValues);

  const filename = `项目整体运营-汇总${runStamp}-${venueLabel}.xlsx`;
  const outputPath = path.join(outputDir, filename);
  await workbook.xlsx.writeFile(outputPath);
  return { filename, outputPath, rowCount: rows.length };
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const runStamp = process.env.MAIZUO_RUN_STAMP || timestamp();
  const outputs = [];

  for (const venue of venues) {
    const result = await fetchVenue(venue);
    const workbook = await writeSourceWorkbook({
      venueLabel: venue.label,
      rows: result.rows,
      runStamp,
    });

    outputs.push({
      venue: venue.label,
      venueId: venue.venueId,
      projectCount: result.projectIds.length,
      eventCount: result.eventIds.length,
      summaryRows: result.rows.length,
      ...workbook,
    });
  }

  console.log(JSON.stringify({ outputDir, runStamp, outputs }, null, 2));
}

main().catch((error) => {
  const needsLogin = /401|403|登录|login|unauthorized|forbidden|UN_LOGIN_ERROR|登陆超时|重新登陆/i.test(
    error.message || "",
  );
  console.error(
    JSON.stringify(
      {
        ok: false,
        needsLogin,
        error: error.message,
      },
      null,
      2,
    ),
  );
  process.exitCode = needsLogin ? 20 : 1;
});
