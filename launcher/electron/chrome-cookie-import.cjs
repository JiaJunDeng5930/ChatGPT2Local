const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify, TextDecoder } = require("node:util");

const runFile = promisify(execFile);
const profileDirectoryPattern = /^(Default|Profile \d+)$/;
const sessionCookiePattern = /^(?:__Secure-)?(?:next-auth|authjs)\.session-token(?:\.(\d+))?$/;
const chromeRoot = path.join(os.homedir(), "Library/Application Support/Google/Chrome");
const domainFilter = "(host_key IN ('chatgpt.com', 'openai.com') OR host_key LIKE '%.chatgpt.com' OR host_key LIKE '%.openai.com')";

function importError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireMacOS() {
  if (process.platform !== "darwin") {
    throw importError("CHROME_IMPORT_UNSUPPORTED_PLATFORM", "Local Chrome cookie import is only supported on macOS.");
  }
}

async function containedRealPath(parent, child) {
  const resolved = await fs.realpath(child);
  const relative = path.relative(parent, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw importError("CHROME_IMPORT_INVALID_PROFILE", "Chrome profile path is outside the Chrome data directory.");
  }
  return resolved;
}

async function listChromeProfiles() {
  requireMacOS();
  let root;
  let entries;
  try {
    root = await fs.realpath(chromeRoot);
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw importError("CHROME_IMPORT_READ_FAILED", "Unable to read local Chrome profiles.");
  }
  let names = {};
  try {
    const statePath = await containedRealPath(root, path.join(root, "Local State"));
    names = JSON.parse(await fs.readFile(statePath, "utf8"))?.profile?.info_cache || {};
  } catch {
    // Directory discovery also works when Chrome has not written its profile names.
  }
  const profiles = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !profileDirectoryPattern.test(entry.name)) continue;
    try {
      await containedRealPath(root, path.join(root, entry.name));
      profiles.push({ id: entry.name, name: typeof names[entry.name]?.name === "string" ? names[entry.name].name : entry.name });
    } catch {
      // Never follow a profile that resolves outside the Chrome data directory.
    }
  }
  return profiles.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

async function readDatabase(databasePath, sql) {
  try {
    const { stdout } = await runFile("/usr/bin/sqlite3", ["-readonly", "-json", "-cmd", ".timeout 5000", databasePath, sql], {
      encoding: "utf8", timeout: 15000, maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(stdout || "[]");
  } catch {
    // Child-process errors can contain Cookie values in stdout. Do not propagate them.
    throw importError("CHROME_IMPORT_READ_FAILED", "Unable to read Chrome cookies. Quit Chrome and try again.");
  }
}

async function readChromeEncryptionKey() {
  try {
    const { stdout } = await runFile("/usr/bin/security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage", "-a", "Chrome"], {
      encoding: "buffer", timeout: 120000, maxBuffer: 4096,
    });
    const password = stdout.at(-1) === 10 ? stdout.subarray(0, -1) : stdout;
    try {
      return crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
    } finally {
      stdout.fill(0);
    }
  } catch {
    throw importError("CHROME_IMPORT_KEYCHAIN_FAILED", "Unable to access Chrome Safe Storage in macOS Keychain. Allow access and try again.");
  }
}

function decryptCookie(row, key, version) {
  if (!row.encrypted_value) return row.value;
  const encrypted = Buffer.from(row.encrypted_value, "hex");
  if (encrypted.subarray(0, 3).toString("ascii") !== "v10") {
    throw importError("CHROME_IMPORT_UNSUPPORTED_ENCRYPTION", "Chrome uses an unsupported cookie encryption format.");
  }
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
    plaintext = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    // Chromium cookie DB v24 binds the encrypted value to SHA-256(host_key).
    // https://chromium.googlesource.com/chromium/src/+/main/net/extras/sqlite/sqlite_persistent_cookie_store.cc
    const offset = version >= 24 ? 32 : 0;
    if (offset && (plaintext.length < offset || !crypto.timingSafeEqual(plaintext.subarray(0, offset), crypto.createHash("sha256").update(row.host_key).digest()))) {
      throw new Error("Cookie domain binding mismatch");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext.subarray(offset));
  } catch {
    throw importError("CHROME_IMPORT_DECRYPT_FAILED", "Unable to decrypt Chrome cookies with Chrome Safe Storage.");
  } finally {
    plaintext?.fill(0);
  }
}

function requireSessionCookies(cookies) {
  const groups = new Map();
  const identities = new Set();
  for (const cookie of cookies) {
    const identity = JSON.stringify([cookie.domain, cookie.path, cookie.name]);
    if (identities.has(identity)) {
      throw importError("CHROME_IMPORT_UNSUPPORTED_SCHEMA", "Chrome contains cookie identities that cannot be imported without losing their scope.");
    }
    identities.add(identity);
    if (!cookie.value || !["chatgpt.com", ".chatgpt.com", "chat.openai.com", ".openai.com"].includes(cookie.domain) || cookie.path !== "/") continue;
    const match = cookie.name.match(sessionCookiePattern);
    if (!match) continue;
    const groupId = `${cookie.domain}\n${cookie.name.replace(/\.\d+$/, "")}`;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(match[1] === undefined ? null : Number(match[1]));
  }
  if (!groups.size) {
    throw importError("CHROME_IMPORT_NO_SESSION", "No supported ChatGPT login cookies were found in this Chrome profile. Sign in to ChatGPT in Chrome first.");
  }
  for (const chunks of groups.values()) {
    const indexes = chunks.filter((index) => index !== null).sort((a, b) => a - b);
    if ((chunks.includes(null) && chunks.length !== 1) || indexes.some((index, position) => index !== position)) {
      throw importError("CHROME_IMPORT_INCOMPLETE_SESSION", "Chrome contains incomplete ChatGPT login cookies. Sign in to ChatGPT in Chrome again.");
    }
  }
}

async function readChromeCookies(profileId) {
  requireMacOS();
  if (typeof profileId !== "string" || !profileDirectoryPattern.test(profileId)) {
    throw importError("CHROME_IMPORT_INVALID_PROFILE", "Select a valid local Chrome profile.");
  }
  let databasePath;
  try {
    const root = await fs.realpath(chromeRoot);
    const profile = await containedRealPath(root, path.join(root, profileId));
    for (const candidate of [path.join(profile, "Network/Cookies"), path.join(profile, "Cookies")]) {
      try {
        databasePath = await containedRealPath(profile, candidate);
        if (!(await fs.stat(databasePath)).isFile()) throw new Error("Not a file");
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  } catch {
    throw importError("CHROME_IMPORT_READ_FAILED", "Unable to read the selected Chrome profile.");
  }
  if (!databasePath) throw importError("CHROME_IMPORT_NO_SESSION", "This Chrome profile has no saved cookies.");
  const columns = new Set((await readDatabase(databasePath, "PRAGMA table_info(cookies);")).map((column) => column.name));
  const required = ["host_key", "name", "value", "encrypted_value", "path", "expires_utc", "has_expires", "is_secure", "is_httponly", "samesite"];
  if (required.some((column) => !columns.has(column))) {
    throw importError("CHROME_IMPORT_UNSUPPORTED_SCHEMA", "Chrome uses an unsupported cookie database schema.");
  }
  const unpartitioned = columns.has("top_frame_site_key") ? " AND top_frame_site_key = ''" : "";
  const sameParty = columns.has("is_same_party") ? " AND is_same_party = 0" : "";
  // Read the original database in one transaction, including committed WAL records.
  // Partitioned cookies cannot be represented by this storage-state contract.
  const result = await readDatabase(databasePath, `BEGIN; SELECT
    (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'version') AS version,
    (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'last_compatible_version') AS compatible_version,
    (SELECT json_group_array(json_object(
      'host_key', host_key, 'name', name, 'value', value,
      'encrypted_value', hex(encrypted_value), 'path', path,
      'expires_utc', expires_utc, 'has_expires', has_expires,
      'is_secure', is_secure, 'is_httponly', is_httponly, 'samesite', samesite
    )) FROM cookies WHERE ${domainFilter}${unpartitioned}${sameParty}) AS cookies; COMMIT;`);
  const version = result[0]?.version;
  const compatibleVersion = result[0]?.compatible_version;
  if (!Number.isInteger(version) || version < 5 || (version > 24 && (!Number.isInteger(compatibleVersion) || compatibleVersion > 24))) {
    throw importError("CHROME_IMPORT_UNSUPPORTED_SCHEMA", "Chrome uses an unsupported cookie database version.");
  }
  let rows;
  try { rows = JSON.parse(result[0].cookies); } catch {
    throw importError("CHROME_IMPORT_READ_FAILED", "Unable to read Chrome cookie records.");
  }
  const now = Date.now() / 1000;
  const liveRows = rows.filter((row) => !row.has_expires || row.expires_utc / 1000000 - 11644473600 > now);
  const sessionGroup = (row) => JSON.stringify([row.host_key, row.path, row.name.replace(/\.\d+$/, "")]);
  const liveSessions = new Set(liveRows.filter((row) => sessionCookiePattern.test(row.name)).map(sessionGroup));
  if (rows.some((row) => sessionCookiePattern.test(row.name) && row.has_expires && row.expires_utc / 1000000 - 11644473600 <= now && liveSessions.has(sessionGroup(row)))) {
    throw importError("CHROME_IMPORT_INCOMPLETE_SESSION", "Chrome contains partially expired ChatGPT login cookies. Sign in to ChatGPT in Chrome again.");
  }
  if (liveRows.some((row) => row.encrypted_value && !row.encrypted_value.startsWith("763130"))) {
    throw importError("CHROME_IMPORT_UNSUPPORTED_ENCRYPTION", "Chrome uses an unsupported cookie encryption format.");
  }
  let key;
  try {
    if (liveRows.some((row) => row.encrypted_value)) key = await readChromeEncryptionKey();
    const cookies = liveRows.map((row) => {
      if (![-1, 0, 1, 2].includes(row.samesite)) {
        throw importError("CHROME_IMPORT_UNSUPPORTED_SCHEMA", "Chrome uses unsupported cookie SameSite metadata.");
      }
      return {
        name: row.name, value: decryptCookie(row, key, version), domain: row.host_key, path: row.path,
        expires: row.has_expires ? row.expires_utc / 1000000 - 11644473600 : -1,
        httpOnly: Boolean(row.is_httponly), secure: Boolean(row.is_secure),
        sameSite: row.samesite === 0 ? "None" : row.samesite === 2 ? "Strict" : "Lax",
      };
    });
    requireSessionCookies(cookies);
    return { cookies, origins: [] };
  } finally {
    key?.fill(0);
  }
}

module.exports = { listChromeProfiles, readChromeCookies };
