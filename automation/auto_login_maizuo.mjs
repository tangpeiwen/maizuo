import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonScript = path.join(workspaceRoot, "automation", "pyautogui_maizuo_login.py");
const timeoutMs = Number(process.env.MAIZUO_AUTO_LOGIN_TIMEOUT_MS || 30_000);

function loadLocalEnv() {
  const envPath = path.join(workspaceRoot, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chromeEvalJs(js) {
  const base64 = Buffer.from(String(js), "utf8").toString("base64");
  return `eval(new TextDecoder().decode(Uint8Array.from(atob('${base64}'), c => c.charCodeAt(0))))`;
}

function getChromeApplicationTargets() {
  return [process.env.MAIZUO_CHROME_APP_PATH || "/Applications/Google Chrome.app", "com.google.Chrome", "Google Chrome"];
}

function executeChromeJs(js) {
  const wrappedJs = chromeEvalJs(String(js));
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
    "          if (String(browserTab.url()).includes('maizuo.maitix.com')) {",
    "            browserWindow.activeTabIndex = tabIndex + 1;",
    "            browserWindow.index = 1;",
    "            chrome.activate();",
    "            const result = browserTab.execute({ javascript: jsCode });",
    "            return result == null ? '' : String(result);",
    "          }",
    "        }",
    "      }",
    "    } catch (error) {",
    "      lastError = error;",
    "    }",
    "  }",
    "  throw new Error('No open maizuo.maitix.com tab found in Chrome. Last Chrome lookup error: ' + (lastError ? String(lastError) : 'none'));",
    "})()",
  ].join("\n");

  return execFileSync("/usr/bin/osascript", ["-l", "JavaScript"], {
    encoding: "utf8",
    input: script,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 10,
  }).trim();
}

function placeChromeOnPrimaryScreen(width, height) {
  const script = [
    "(() => {",
    `  const chromeTargets = ${JSON.stringify(getChromeApplicationTargets())};`,
    "  let lastError = null;",
    "  for (const chromeTarget of chromeTargets) {",
    "    try {",
    "      const chrome = Application(chromeTarget);",
    "      for (const browserWindow of chrome.windows()) {",
    "        const tabs = browserWindow.tabs();",
    "        for (let tabIndex = 0; tabIndex < tabs.length; tabIndex += 1) {",
    "          if (String(tabs[tabIndex].url()).includes('maizuo.maitix.com')) {",
    "            browserWindow.activeTabIndex = tabIndex + 1;",
    `            browserWindow.bounds = { x: 0, y: 25, width: ${Math.round(width)}, height: ${Math.max(600, Math.round(height - 110))} };`,
    "            browserWindow.index = 1;",
    "            chrome.activate();",
    "            return 'positioned';",
    "          }",
    "        }",
    "      }",
    "    } catch (error) { lastError = error; }",
    "  }",
    "  throw new Error('No open maizuo.maitix.com tab found in Chrome. Last Chrome lookup error: ' + (lastError ? String(lastError) : 'none'));",
    "})()",
  ].join("\n");

  return execFileSync("/usr/bin/osascript", ["-l", "JavaScript"], {
    encoding: "utf8",
    input: script,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function readLoginUi() {
  const raw = executeChromeJs(`(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const exactText = (texts) => [...document.querySelectorAll("body *")]
      .filter((element) => visible(element) && texts.includes((element.innerText || "").trim()))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });
    const toScreenRect = (rect) => {
      const borderX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
      const chromeY = Math.max(0, window.outerHeight - window.innerHeight - borderX);
      return {
        left: window.screenX + borderX + rect.left,
        top: window.screenY + chromeY + rect.top,
        width: rect.width,
        height: rect.height,
        right: window.screenX + borderX + rect.right,
        bottom: window.screenY + chromeY + rect.bottom,
      };
    };

    const prompt = exactText(["请按住滑块，拖动到最右边", "验证通过"])[0] || null;
    let slider = prompt;
    while (slider && slider.parentElement) {
      const rect = slider.getBoundingClientRect();
      if (rect.width >= 240 && rect.width <= 900 && rect.height >= 35 && rect.height <= 100) break;
      slider = slider.parentElement;
    }

    const loginCandidates = exactText(["登录", "登 录"])
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 32 && rect.height <= 100;
      })
      .sort((a, b) => {
        const aButton = a.tagName === "BUTTON" ? 0 : 1;
        const bButton = b.tagName === "BUTTON" ? 0 : 1;
        return aButton - bButton;
      });
    const loginButton = loginCandidates[0] || null;

    return JSON.stringify({
      url: location.href,
      readyState: document.readyState,
      sliderState: prompt ? (prompt.innerText || "").trim() : null,
      sliderRect: slider ? toScreenRect(slider.getBoundingClientRect()) : null,
      loginRect: loginButton ? toScreenRect(loginButton.getBoundingClientRect()) : null,
    });
  })()`);

  if (!raw) throw new Error("Chrome returned an empty login-page UI result");
  return JSON.parse(raw);
}

function runPyAutoGui(args) {
  const pythonBin = process.env.MAIZUO_PYTHON_BIN || "/usr/bin/python3";
  try {
    return execFileSync(pythonBin, [pythonScript, ...args.map(String)], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = String(error?.stderr || "").trim();
    throw new Error(`PyAutoGUI Maizuo action failed${stderr ? `: ${stderr}` : ""}`);
  }
}

async function waitForUi(predicate, description) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = readLoginUi();
    if (predicate(latest)) return latest;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(latest)}`);
}

function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

async function main() {
  loadLocalEnv();
  if (!fs.existsSync(pythonScript)) throw new Error(`Missing PyAutoGUI helper: ${pythonScript}`);

  const primaryScreen = JSON.parse(runPyAutoGui(["size"]));
  if (process.env.MAIZUO_AUTO_LOGIN_REPOSITION_CHROME !== "0") {
    placeChromeOnPrimaryScreen(primaryScreen.width, primaryScreen.height);
    await sleep(1_000);
  }

  // An expired API session does not always redirect an already-open /home tab.
  // Loading /login forces Chrome to either render the login UI (expired) or
  // redirect straight back to /home (session still valid).
  executeChromeJs(`location.href = "https://maizuo.maitix.com/login"; "navigating";`);
  await sleep(1_500);

  let ui = await waitForUi(
    (state) => /\/home(?:[/?#]|$)/.test(new URL(state.url).pathname) || (state.sliderRect && state.loginRect),
    "the Maizuo login UI",
  );

  if (/\/home(?:[/?#]|$)/.test(new URL(ui.url).pathname)) {
    console.log(JSON.stringify({ ok: true, action: "already_logged_in", url: ui.url }));
    return;
  }

  if (ui.sliderState !== "验证通过") {
    const slider = ui.sliderRect;
    const y = slider.top + slider.height / 2;
    const startX = slider.left + slider.height / 2;
    // The slider clamps the handle itself. Moving the pointer a few pixels past
    // the rail avoids fractional-coordinate rounding that otherwise looks
    // complete visually but is released just short of the verification gate.
    const endX = slider.right + 8;
    // Chrome activation through Apple Events becomes visible asynchronously.
    // Give macOS time to finish the focus change before PyAutoGUI presses down.
    executeChromeJs(`"focused"`);
    await sleep(1_000);
    runPyAutoGui([
      "drag",
      "--start-x", startX,
      "--start-y", y,
      "--end-x", endX,
      "--end-y", y,
      "--duration", process.env.MAIZUO_SLIDER_DRAG_SECONDS || "1.5",
    ]);
    ui = await waitForUi(
      (state) => state.sliderState === "验证通过" || /\/home(?:[/?#]|$)/.test(new URL(state.url).pathname),
      "slider verification",
    );
  }

  if (/\/home(?:[/?#]|$)/.test(new URL(ui.url).pathname)) {
    console.log(JSON.stringify({ ok: true, action: "dragged_and_logged_in", url: ui.url }));
    return;
  }

  if (!ui.loginRect) throw new Error(`Maizuo login button was not found after slider verification: ${JSON.stringify(ui)}`);
  const login = center(ui.loginRect);
  executeChromeJs(`"focused"`);
  await sleep(1_000);
  runPyAutoGui(["click", "--x", login.x, "--y", login.y]);

  const result = await waitForUi(
    (state) => !/\/login(?:[/?#]|$)/.test(new URL(state.url).pathname),
    "Maizuo login navigation",
  );
  console.log(JSON.stringify({ ok: true, action: "dragged_and_logged_in", url: result.url }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, type: "maizuo_auto_login", error: error.message || String(error) }));
  process.exitCode = 21;
});
