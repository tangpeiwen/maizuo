import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const appId = process.env.FEISHU_APP_ID || process.env.LARK_APP_ID || "";
const appSecret = process.env.FEISHU_APP_SECRET || process.env.LARK_APP_SECRET || "";
const chatId = process.env.FEISHU_CHAT_ID || process.env.LARK_CHAT_ID || "";
const filePath =
  process.env.FEISHU_FILE_PATH ||
  process.argv[2] ||
  path.join(workspaceRoot, "outputs", "maizuo", "项目整体运营-关键票数合并.xlsx");

function requireConfig() {
  const missing = [];
  if (!appId) missing.push("FEISHU_APP_ID");
  if (!appSecret) missing.push("FEISHU_APP_SECRET");
  if (!chatId) missing.push("FEISHU_CHAT_ID");
  return missing;
}

async function readJsonResponse(response, context) {
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${context} returned non-JSON response: HTTP ${response.status} ${text.slice(0, 1000)}`);
  }

  if (!response.ok || json.code !== 0) {
    throw new Error(`${context} failed: HTTP ${response.status} ${text.slice(0, 1000)}`);
  }

  return json;
}

async function getTenantAccessToken() {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });
  const json = await readJsonResponse(response, "Feishu tenant access token");
  if (!json.tenant_access_token) throw new Error("Feishu tenant access token response missing tenant_access_token");
  return json.tenant_access_token;
}

async function uploadFile({ token, targetPath }) {
  const filename = path.basename(targetPath);
  const bytes = await fs.readFile(targetPath);
  const form = new FormData();
  form.append("file_type", "xls");
  form.append("file_name", filename);
  form.append(
    "file",
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );

  const response = await fetch("https://open.feishu.cn/open-apis/im/v1/files", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: form,
  });
  const json = await readJsonResponse(response, "Feishu file upload");
  const fileKey = json?.data?.file_key;
  if (!fileKey) throw new Error("Feishu file upload response missing data.file_key");
  return fileKey;
}

async function sendFileMessage({ token, fileKey }) {
  const response = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "file",
      content: JSON.stringify({
        file_key: fileKey,
      }),
    }),
  });
  return readJsonResponse(response, "Feishu file message");
}

async function main() {
  const missing = requireConfig();
  if (missing.length > 0) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          sent: false,
          reason: `missing ${missing.join(", ")}`,
          filePath,
        },
        null,
        2,
      ),
    );
    return;
  }

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`File path is not a file: ${filePath}`);

  const token = await getTenantAccessToken();
  const fileKey = await uploadFile({ token, targetPath: filePath });
  const response = await sendFileMessage({ token, fileKey });

  console.log(
    JSON.stringify(
      {
        ok: true,
        sent: true,
        filePath,
        fileKey,
        response,
      },
      null,
      2,
    ),
  );
}

await main();
