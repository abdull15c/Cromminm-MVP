import cors from "@fastify/cors";
import Fastify from "fastify";
import { chromium } from "playwright";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { generateFingerprint, validateFingerprintConsistency } from "./services/fingerprintGenerator.js";
import { generateStealthPatches } from "./services/stealthPatches.js";
import { generateHumanizationScript } from "./services/humanization.js";
import { 
  parseNetscapeCookies, 
  parseJsonCookies, 
  exportNetscapeCookies, 
  exportJsonCookies,
  validateCookie,
  mergeCookies,
  filterExpiredCookies,
  type Cookie,
  type CookieImportFormat,
  type CookieExportFormat
} from "./services/cookieManager.js";

// Constants
const PORT = Number(process.env.PORT ?? 8787);
const PROXY_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const AUTOMATION_LOG_MAX_LINES = 250;
const PROXY_CHECK_TIMEOUT_MS = 5000;

type Profile = {
  id: string;
  name: string;
  proxy?: string;
  createdAt: string;
  canvasNoiseSeed?: string;
};

type ImportedProfile = {
  name: string;
  proxy?: string;
};

type ProxyParsed = {
  protocol: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
};

type SessionProfileId =
  | "auto"
  | "desktop_en"
  | "desktop_ru"
  | "low_end_mobile"
  | "mid_range_laptop"
  | "high_end_desktop"
  | "australia_desktop"
  | "australia_mobile";

type SessionProfile = {
  id: Exclude<SessionProfileId, "auto">;
  locale: string;
  timezoneId: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  hasTouch: boolean;
  hardwareConcurrency: number;
  deviceMemory: number;
  userAgent: string;
  extraHTTPHeaders: Record<string, string>;
  geolocation?: { latitude: number; longitude: number; accuracy: number };
  clientHints: {
    platform: "Windows" | "Android";
    platformVersion: string;
    architecture: "x86" | "arm";
    bitness: "64" | "";
    model: string;
    majorVersion: string;
    fullVersion: string;
    formFactors: Array<"Desktop" | "Mobile">;
  };
  webgl?: {
    vendor: string;
    renderer: string;
    maxTextureSize: number;
    maxViewportDimensions: [number, number];
  };
};

type RunningProfileSession = {
  close: () => Promise<void>;
};

const app = Fastify({ logger: true });

const isProd = process.env.NODE_ENV === "production";
const rootDir = isProd
  ? (process.env.APP_ROOT_DIR ?? process.cwd())
  : process.cwd();

const dataDir = process.env.APP_USER_DATA_DIR
  ? join(process.env.APP_USER_DATA_DIR, "data")
  : join(rootDir, "data");
const profilesFile = join(dataDir, "profiles.json");
const sessionRootDir = join(dataDir, "sessions");
const sessions = new Map<string, RunningProfileSession>();
const pendingProfileStarts = new Set<string>(); // Lock for preventing parallel starts
const repoRoot = isProd ? rootDir : join(process.cwd(), "..");
const automationOutputDir = join(repoRoot, "automation", "output");

type AutomationStatus = {
  id: string;
  running: boolean;
  scenario: string;
  sessionProfile: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  pid?: number;
  proxy?: string;
  logs: string[];
};

const activeRuns = new Map<string, AutomationStatus>();
const proxyCooldowns = new Map<string, number>();

const maskProxyCredentials = (proxyUrl: string): string => {
  if (!proxyUrl || typeof proxyUrl !== 'string') return proxyUrl;
  try {
    const url = new URL(proxyUrl);
    if (url.username || url.password) {
      return `${url.protocol}//${url.username ? '***' : ''}${url.password ? ':***' : ''}@${url.host}`;
    }
    return proxyUrl;
  } catch {
    return proxyUrl;
  }
};

const getProxies = async (): Promise<string[]> => {
  try {
    const data = await readFile(join(dataDir, "proxies.txt"), "utf-8");
    return data.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  } catch {
    return [];
  }
};

let lastProxyIndex = 0;
const getNextProxy = async (): Promise<string | undefined> => {
  const proxies = await getProxies();
  if (proxies.length === 0) return undefined;
  
  const now = Date.now();
  const availableProxies = proxies.filter(p => !proxyCooldowns.has(p) || proxyCooldowns.get(p)! < now);
  if (availableProxies.length === 0) return undefined;
  
  lastProxyIndex = (lastProxyIndex + 1) % availableProxies.length;
  return availableProxies[lastProxyIndex];
};

const cooldownProxy = (proxy: string) => {
  proxyCooldowns.set(proxy, Date.now() + PROXY_COOLDOWN_MS);
};
type RuntimeOverrides = {
  readingDurationMs?: number;
  deviceScaleFactor?: number;
  hasTouch?: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  geoLat?: number;
  geoLon?: number;
  geoAccuracy?: number;
};

const sessionProfiles: Record<Exclude<SessionProfileId, "auto">, SessionProfile> = {
  desktop_en: {
    id: "desktop_en",
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    geolocation: { latitude: 40.7128, longitude: -74.006, accuracy: 80 },
    clientHints: {
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      bitness: "64",
      model: "",
      majorVersion: "140",
      fullVersion: "140.0.0.0",
      formFactors: ["Desktop"],
    },
  },
  desktop_ru: {
    id: "desktop_ru",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    hasTouch: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7" },
    geolocation: { latitude: 55.7558, longitude: 37.6176, accuracy: 120 },
    clientHints: {
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      bitness: "64",
      model: "",
      majorVersion: "140",
      fullVersion: "140.0.0.0",
      formFactors: ["Desktop"],
    },
  },
  low_end_mobile: {
    id: "low_end_mobile",
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    hardwareConcurrency: 4,
    deviceMemory: 4,
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    geolocation: { latitude: 34.0522, longitude: -118.2437, accuracy: 120 },
    clientHints: {
      platform: "Android",
      platformVersion: "13.0.0",
      architecture: "arm",
      bitness: "",
      model: "Pixel 5",
      majorVersion: "140",
      fullVersion: "140.0.0.0",
      formFactors: ["Mobile"],
    },
    webgl: {
      vendor: "Qualcomm",
      renderer: "Adreno (TM) 620",
      maxTextureSize: 8192,
      maxViewportDimensions: [8192, 8192],
    },
  },
  mid_range_laptop: {
    id: "mid_range_laptop",
    locale: "en-US",
    timezoneId: "America/Chicago",
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1.25,
    hasTouch: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    geolocation: { latitude: 41.8781, longitude: -87.6298, accuracy: 90 },
    clientHints: {
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      bitness: "64",
      model: "",
      majorVersion: "140",
      fullVersion: "140.0.0.0",
      formFactors: ["Desktop"],
    },
  },
  high_end_desktop: {
    id: "high_end_desktop",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    hasTouch: false,
    hardwareConcurrency: 16,
    deviceMemory: 16,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    geolocation: { latitude: 37.7749, longitude: -122.4194, accuracy: 60 },
    clientHints: {
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      bitness: "64",
      model: "",
      majorVersion: "140",
      fullVersion: "140.0.0.0",
      formFactors: ["Desktop"],
    },
  },
  australia_desktop: {
    id: "australia_desktop",
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "Accept-Language": "en-AU,en;q=0.9" },
    geolocation: { latitude: -33.8688, longitude: 151.2093, accuracy: 90 },
    clientHints: {
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      bitness: "64",
      model: "",
      majorVersion: "140",
      fullVersion: "140.0.0.0",
      formFactors: ["Desktop"],
    },
  },
  australia_mobile: {
    id: "australia_mobile",
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S901E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-AU,en;q=0.9",
      "Sec-CH-UA-Mobile": "?1",
      "Sec-CH-UA-Platform": '"Android"',
    },
    geolocation: { latitude: -33.8688, longitude: 151.2093, accuracy: 120 },
    clientHints: {
      platform: "Android",
      platformVersion: "14.0.0",
      architecture: "arm",
      bitness: "",
      model: "SM-S901E",
      majorVersion: "140",
      fullVersion: "140.0.0.0",
      formFactors: ["Mobile"],
    },
    webgl: {
      vendor: "Qualcomm",
      renderer: "Adreno (TM) 730",
      maxTextureSize: 8192,
      maxViewportDimensions: [8192, 8192],
    },
  },
};

const resolveAutoSessionProfileId = (profile?: Profile): Exclude<SessionProfileId, "auto"> => {
  const text = `${profile?.name ?? ""} ${profile?.proxy ?? ""}`.toLowerCase();
  if (/\b(mobile|android|phone|s901|pixel)\b/.test(text)) return "australia_mobile";
  if (/\b(au|aus|australia|sydney|telstra)\b/.test(text)) return "australia_desktop";
  return "desktop_en";
};

const getSessionProfile = (id?: string, profile?: Profile): SessionProfile => {
  const selectedId = id === "auto" ? resolveAutoSessionProfileId(profile) : (id as Exclude<SessionProfileId, "auto"> | undefined);
  return sessionProfiles[selectedId ?? "desktop_en"] ?? sessionProfiles.desktop_en;
};

const getLatestAutomationRun = async (): Promise<{
  report: Record<string, unknown>;
  runDir: string;
} | null> => {
  try {
    const runs = await readdir(automationOutputDir, { withFileTypes: true });
    const runDirs = runs
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .sort((a, b) => b.localeCompare(a));

    if (runDirs.length === 0) return null;

    for (const runDir of runDirs) {
      const candidate = join(automationOutputDir, runDir, "report.json");
      try {
        const content = await readFile(candidate, "utf-8");
        return {
          report: JSON.parse(content) as Record<string, unknown>,
          runDir: join(automationOutputDir, runDir),
        };
      } catch {
        // Ignore broken or missing report in this run folder.
      }
    }
    return null;
  } catch {
    return null;
  }
};

const openPathInSystemExplorer = async (targetPath: string): Promise<boolean> => {
  try {
    if (process.platform === "win32") {
      const proc = spawn("explorer", [targetPath], { detached: true, stdio: "ignore" });
      proc.unref();
      return true;
    }
    if (process.platform === "darwin") {
      const proc = spawn("open", [targetPath], { detached: true, stdio: "ignore" });
      proc.unref();
      return true;
    }
    const proc = spawn("xdg-open", [targetPath], { detached: true, stdio: "ignore" });
    proc.unref();
    return true;
  } catch {
    return false;
  }
};

const loadProfiles = async (): Promise<Profile[]> => {
  try {
    const content = await readFile(profilesFile, "utf-8");
    return JSON.parse(content) as Profile[];
  } catch {
    return [];
  }
};

const saveProfiles = async (profiles: Profile[]): Promise<void> => {
  await mkdir(dataDir, { recursive: true });

  const tempFile = `${profilesFile}.${process.pid}.tmp`;
  const content = JSON.stringify(profiles, null, 2);

  try {
    await writeFile(tempFile, content, "utf-8");
    try {
      await rename(tempFile, profilesFile);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "EPERM" || process.platform === "win32") {
        await rm(profilesFile, { force: true });
        await rename(tempFile, profilesFile);
      } else {
        throw err;
      }
    }
  } catch (error) {
    await rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
};

const nowIso = (): string => new Date().toISOString();
const profileId = (): string => `p_${Date.now().toString(36)}`;

const parseProxy = (proxy: string): ProxyParsed | null => {
  const value = proxy.trim();
  if (!value) return null;

  // Try URL parsing first (handles all formats including IPv6)
  if (value.includes("://")) {
    try {
      const url = new URL(value);
      const protocol = url.protocol.replace(":", "").toLowerCase();
      const host = url.hostname; // hostname strips brackets from IPv6
      const port = Number(url.port);
      if (!host || !Number.isFinite(port) || port <= 0) return null;
      return {
        protocol,
        host,
        port,
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
      };
    } catch {
      return null;
    }
  }

  // Legacy format: host:port or host:port:user:pass
  // This doesn't support IPv6 properly, but kept for backward compatibility
  const parts = value.split(":");
  if (parts.length < 2) return null;

  if (parts.length === 4) {
    const [host, portRaw, username, password] = parts;
    const port = Number(portRaw);
    if (!host || !Number.isFinite(port) || port <= 0) return null;
    return { protocol: "http", host, port, username, password };
  }

  const portRaw = parts.pop();
  const host = parts.join(":");
  const port = Number(portRaw);
  if (!host || !Number.isFinite(port) || port <= 0) return null;
  return { protocol: "http", host, port };
};

const supportedProxyProtocols = new Set(["http", "https", "socks5"]);

const formatProxyForChrome = (parsed: ProxyParsed): string => {
  const protocol = parsed.protocol === "socks5" ? "socks5" : parsed.protocol;
  return `${protocol}://${parsed.host}:${parsed.port}`;
};

const formatProxyForStorage = (parsed: ProxyParsed): string => {
  const credentials = parsed.username || parsed.password
    ? `${encodeURIComponent(parsed.username ?? "")}:${encodeURIComponent(parsed.password ?? "")}@`
    : "";
  return `${parsed.protocol}://${credentials}${parsed.host}:${parsed.port}`;
};

const normalizeProxyForChrome = (proxy: string): { ok: true; value: string } | { ok: false; error: string } => {
  const parsed = parseProxy(proxy);
  if (!parsed) {
    return { ok: false, error: "Invalid proxy format. Use http://host:port, https://host:port or socks5://host:port" };
  }

  if (!supportedProxyProtocols.has(parsed.protocol)) {
    return { ok: false, error: "Unsupported proxy protocol. Allowed: http, https, socks5" };
  }

  return { ok: true, value: formatProxyForStorage(parsed) };
};

const createControlExtension = async (extensionDir: string, parsed?: ProxyParsed): Promise<void> => {
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    join(extensionDir, "manifest.json"),
    JSON.stringify(
      {
        manifest_version: 3,
        name: "Profile Network Controls",
        version: "1.0.0",
        permissions: ["privacy", "webRequest", "webRequestAuthProvider"],
        host_permissions: ["<all_urls>"],
        background: {
          service_worker: "background.js",
        },
      },
      null,
      2,
    ),
    "utf-8",
  );

  const authHandler = parsed?.username || parsed?.password
    ? `chrome.webRequest.onAuthRequired.addListener(
  () => ({ authCredentials: ${JSON.stringify({ username: parsed.username ?? "", password: parsed.password ?? "" })} }),
  { urls: ["<all_urls>"] },
  ["blocking"]
);`
    : "";
  const background = `chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: "disable_non_proxied_udp" });
chrome.privacy.network.webRTCIPHandlingPolicy.get({}, (details) => {
  if (details.value !== "disable_non_proxied_udp") {
    chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: "disable_non_proxied_udp" });
  }
});
${authHandler}
`;
  await writeFile(join(extensionDir, "background.js"), background, "utf-8");
};

const addFingerprintInitScript = async (
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>, 
  profile: SessionProfile,
  canvasNoiseSeed?: string,
  enableHumanization: boolean = true
): Promise<void> => {
  // Generate enhanced stealth patches
  const stealthScript = generateStealthPatches({
    locale: profile.locale,
    platform: profile.clientHints.platform === "Windows" ? "Win32" : profile.clientHints.platform === "macOS" ? "MacIntel" : "Linux armv8l",
    hardwareConcurrency: profile.hardwareConcurrency,
    deviceMemory: profile.deviceMemory,
    hasTouch: profile.hasTouch,
    fonts: [], // Will be populated from fingerprint database
    plugins: [
      { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
      { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "Portable Document Format" },
      { name: "Chromium PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "Portable Document Format" }
    ],
    webgl: profile.webgl,
    canvasNoiseSeed: canvasNoiseSeed ?? Math.random().toString(36).substring(2, 15)
  });
  
  await context.addInitScript(stealthScript);
  
  // Add humanization behaviors
  if (enableHumanization) {
    const humanizationScript = generateHumanizationScript({
      mouseSpeed: 'medium',
      typingSpeed: 'medium',
      enableMicroPauses: true,
      enableTypos: false // Disabled by default to avoid breaking forms
    });
    
    await context.addInitScript(humanizationScript);
  }
};

const checkProxyReachable = async (
  proxy: string,
): Promise<{ ok: boolean; latencyMs?: number; message: string }> => {
  const parsed = parseProxy(proxy);
  if (!parsed) {
    return {
      ok: false,
      message: "Invalid proxy format. Use protocol://host:port",
    };
  }

  if (!supportedProxyProtocols.has(parsed.protocol)) {
    return {
      ok: false,
      message: "Unsupported proxy protocol. Allowed: http, https, socks5",
    };
  }

  const startedAt = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: parsed.host,
      port: parsed.port,
      timeout: PROXY_CHECK_TIMEOUT_MS,
    });

    socket.once("connect", () => {
      const latencyMs = Date.now() - startedAt;
      socket.destroy();
      resolve({ ok: true, latencyMs, message: "Proxy is reachable" });
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve({ ok: false, message: "Proxy timeout" });
    });

    socket.once("error", () => {
      socket.destroy();
      resolve({ ok: false, message: "Cannot connect to proxy" });
    });
  });
};

await app.register(cors, {
  origin: (origin, callback) => {
    // В продакшене/на сервере разрешаем любые источники для удобства работы с удаленным UI
    callback(null, true);
  },
});

app.get("/health", async () => ({
  status: "ok",
  time: nowIso(),
  activeSessions: sessions.size,
}));

app.get("/profiles", async () => {
  const profiles = await loadProfiles();
  return {
    items: profiles.map((profile) => ({
      ...profile,
      running: sessions.has(profile.id),
    })),
  };
});

app.post<{ Body: { name: string; proxy?: string } }>(
  "/profiles",
  async (request, reply) => {
    const { name, proxy } = request.body;

    if (!name?.trim()) {
      return reply.code(400).send({ error: "Profile name is required" });
    }

    const profiles = await loadProfiles();
    const normalizedProxy = proxy?.trim()
      ? normalizeProxyForChrome(proxy.trim())
      : undefined;
    if (normalizedProxy && !normalizedProxy.ok) {
      return reply.code(400).send({ error: normalizedProxy.error });
    }

    const profile: Profile = {
      id: profileId(),
      name: name.trim(),
      proxy: normalizedProxy?.value,
      createdAt: nowIso(),
      canvasNoiseSeed: Math.random().toString(36).substring(2, 15),
    };

    profiles.push(profile);
    await saveProfiles(profiles);

    return reply.code(201).send(profile);
  },
);

app.put<{ Params: { id: string }; Body: { name: string; proxy?: string } }>(
  "/profiles/:id",
  async (request, reply) => {
    const { id } = request.params;
    const { name, proxy } = request.body;

    if (!name?.trim()) {
      return reply.code(400).send({ error: "Profile name is required" });
    }

    const normalizedProxy = proxy?.trim()
      ? normalizeProxyForChrome(proxy.trim())
      : undefined;
    if (normalizedProxy && !normalizedProxy.ok) {
      return reply.code(400).send({ error: normalizedProxy.error });
    }

    const profiles = await loadProfiles();
    const index = profiles.findIndex((item) => item.id === id);
    if (index === -1) {
      return reply.code(404).send({ error: "Profile not found" });
    }

    const updated: Profile = {
      ...profiles[index],
      name: name.trim(),
      proxy: normalizedProxy?.value,
    };
    profiles[index] = updated;
    await saveProfiles(profiles);

    return { ok: true, item: updated };
  },
);

app.delete<{ Params: { id: string } }>("/profiles/:id", async (request, reply) => {
  const { id } = request.params;
  const session = sessions.get(id);
  if (session) {
    await session.close();
    sessions.delete(id);
  }

  const profiles = await loadProfiles();
  const next = profiles.filter((item) => item.id !== id);
  if (next.length === profiles.length) {
    return reply.code(404).send({ error: "Profile not found" });
  }

  await saveProfiles(next);
  await rm(join(sessionRootDir, id), { recursive: true, force: true });

  return { ok: true, profileId: id };
});

app.get("/profiles/export", async () => {
  const profiles = await loadProfiles();
  return {
    version: 1,
    exportedAt: nowIso(),
    items: profiles,
  };
});

app.post<{ Body: { items?: ImportedProfile[]; mode?: "merge" | "replace" } }>(
  "/profiles/import",
  async (request, reply) => {
    const { items, mode } = request.body;
    if (!items || !Array.isArray(items)) {
      return reply.code(400).send({ error: "items array is required" });
    }

    const cleaned = items
      .map((item) => ({
        name: item.name?.trim(),
        proxy: item.proxy?.trim() || undefined,
      }))
      .filter((item) => item.name);

    const invalidProxy = cleaned
      .map((item) => (item.proxy ? normalizeProxyForChrome(item.proxy) : undefined))
      .find((item) => item && !item.ok);
    if (invalidProxy && !invalidProxy.ok) {
      return reply.code(400).send({ error: invalidProxy.error });
    }

    if (cleaned.length === 0) {
      return reply.code(400).send({ error: "No valid profiles to import" });
    }

    const mapped: Profile[] = cleaned.map((item) => ({
      id: profileId(),
      name: item.name as string,
      proxy: item.proxy ? (normalizeProxyForChrome(item.proxy) as { ok: true; value: string }).value : undefined,
      createdAt: nowIso(),
      canvasNoiseSeed: Math.random().toString(36).substring(2, 15),
    }));

    const current = mode === "replace" ? [] : await loadProfiles();
    const next = [...current, ...mapped];
    await saveProfiles(next);

    return {
      ok: true,
      imported: mapped.length,
      total: next.length,
    };
  },
);

app.post<{ Body: { proxy: string } }>("/proxy/check", async (request, reply) => {
  const { proxy } = request.body;
  if (!proxy?.trim()) {
    return reply.code(400).send({ error: "proxy is required" });
  }

  const normalizedProxy = normalizeProxyForChrome(proxy.trim());
  if (!normalizedProxy.ok) {
    return reply.code(400).send({ ok: false, error: normalizedProxy.error });
  }

  const result = await checkProxyReachable(normalizedProxy.value);
  return result;
});

app.get("/automation/status", async () => {
  return { runs: Array.from(activeRuns.values()) };
});

app.get("/automation/report/latest", async () => {
  const latest = await getLatestAutomationRun();
  if (!latest) {
    return { exists: false };
  }
  return { exists: true, report: latest.report };
});

app.post("/automation/report/latest/open", async (request, reply) => {
  const latest = await getLatestAutomationRun();
  if (!latest) {
    return reply.code(404).send({ error: "No automation report found" });
  }

  const opened = await openPathInSystemExplorer(latest.runDir);
  if (!opened) {
    return reply.code(500).send({ error: "Failed to open report folder" });
  }

  return { ok: true, path: latest.runDir };
});

app.post<{
  Body: {
    scenario?: "visit" | "search" | "snapshot" | "warmup" | "ai-explore";
    sessionProfile?: SessionProfileId;
    runtimeOverrides?: RuntimeOverrides;
    healthCheck?: boolean;
    /** Target URL for automation (passed to run.mjs as BASE_URL) */
    baseUrl?: string;
  };
}>(
  "/automation/run",
  async (request, reply) => {
    const scenario = request.body?.scenario ?? "visit";
    const requestedSessionProfile = request.body?.sessionProfile ?? "auto";
    const healthCheck = request.body?.healthCheck ?? false;
    const runtime = request.body?.runtimeOverrides ?? {};
    const baseUrlFromBody = request.body?.baseUrl?.trim();
    const allowedProfiles = new Set([
      "desktop_en",
      "desktop_ru",
      "low_end_mobile",
      "mid_range_laptop",
      "high_end_desktop",
      "australia_desktop",
      "australia_mobile",
      "auto",
    ]);
    if (!allowedProfiles.has(requestedSessionProfile)) {
      return reply.code(400).send({ error: "Unsupported session profile" });
    }

    const proxy = await getNextProxy();
    const sessionProfile = requestedSessionProfile === "auto"
      ? (proxy && /\b(au|aus|australia|sydney|telstra)\b/i.test(proxy) ? "australia_desktop" : "desktop_en")
      : requestedSessionProfile;
    const runId = `run_${Date.now()}_${Math.floor(Math.random()*1000)}`;

    const automationScriptPath = join(rootDir, "automation", "run.mjs");
    
    // Security: Validate that automationScriptPath is within rootDir
    const resolvedScriptPath = path.resolve(automationScriptPath);
    const resolvedRootDir = path.resolve(rootDir);
    if (!resolvedScriptPath.startsWith(resolvedRootDir)) {
      return reply.code(500).send({ error: "Invalid automation script path" });
    }
    
    const nodeExecutable = isProd ? process.execPath : "node";
    const spawnEnv = isProd ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env;

    const runner = spawn(nodeExecutable, [automationScriptPath], {
      cwd: rootDir,
      env: {
        ...spawnEnv,
        ALLOW_AUTOMATION: "true",
        BASE_URL: baseUrlFromBody || process.env.BASE_URL || "https://example.com",
        SCENARIO: scenario,
        SESSION_PROFILE: sessionProfile,
        PROXY_URL: proxy ?? process.env.PROXY_URL,
        HEALTH_CHECK: healthCheck ? "true" : "false",
        READING_DURATION_MS:
          typeof runtime.readingDurationMs === "number"
            ? String(runtime.readingDurationMs)
            : process.env.READING_DURATION_MS,
        DEVICE_SCALE_FACTOR:
          typeof runtime.deviceScaleFactor === "number"
            ? String(runtime.deviceScaleFactor)
            : process.env.DEVICE_SCALE_FACTOR,
        HAS_TOUCH:
          typeof runtime.hasTouch === "boolean"
            ? String(runtime.hasTouch)
            : process.env.HAS_TOUCH,
        HARDWARE_CONCURRENCY:
          typeof runtime.hardwareConcurrency === "number"
            ? String(runtime.hardwareConcurrency)
            : process.env.HARDWARE_CONCURRENCY,
        DEVICE_MEMORY:
          typeof runtime.deviceMemory === "number"
            ? String(runtime.deviceMemory)
            : process.env.DEVICE_MEMORY,
        GEO_LAT:
          typeof runtime.geoLat === "number" ? String(runtime.geoLat) : process.env.GEO_LAT,
        GEO_LON:
          typeof runtime.geoLon === "number" ? String(runtime.geoLon) : process.env.GEO_LON,
        GEO_ACCURACY:
          typeof runtime.geoAccuracy === "number"
            ? String(runtime.geoAccuracy)
            : process.env.GEO_ACCURACY,
      },
      stdio: "pipe",
    });

    const status: AutomationStatus = {
      id: runId,
      running: true,
      scenario,
      sessionProfile,
      startedAt: nowIso(),
      pid: runner.pid,
      proxy,
      logs: [],
    };
    activeRuns.set(runId, status);

    const pushAutomationLog = (line: string) => {
      // Mask proxy credentials in logs
      let sanitizedLine = line;
      if (proxy && line.includes(proxy)) {
        sanitizedLine = line.replace(proxy, maskProxyCredentials(proxy));
      }
      
      const entry = `[${new Date().toISOString()}] ${sanitizedLine}`;
      status.logs.push(entry);
      if (status.logs.length > AUTOMATION_LOG_MAX_LINES) {
        status.logs = status.logs.slice(-AUTOMATION_LOG_MAX_LINES);
      }
      
      // Auto cooldown for 403 / 429
      if (line.includes("403") || line.includes("429")) {
        if (proxy) {
          cooldownProxy(proxy);
          status.logs.push(`[${new Date().toISOString()}] Proxy ${maskProxyCredentials(proxy)} cooled down due to 403/429.`);
        }
      }
    };

    pushAutomationLog(`automation started (scenario=${scenario}, profile=${sessionProfile}, proxy=${proxy ? maskProxyCredentials(proxy) : "none"})`);

    runner.stdout?.on("data", (chunk: Buffer) => {
      pushAutomationLog(chunk.toString().trim());
    });
    runner.stderr?.on("data", (chunk: Buffer) => {
      pushAutomationLog(chunk.toString().trim());
    });
    runner.on("close", (code) => {
      status.running = false;
      status.exitCode = code;
      status.finishedAt = nowIso();
      pushAutomationLog(`automation finished with code ${code}`);
    });

    return {
      ok: true,
      id: runId,
      pid: runner.pid,
      scenario,
      sessionProfile,
      proxy
    };
  },
);

app.post<{ Params: { pid: string } }>("/automation/:pid/stop", async (request, reply) => {
  const pid = Number(request.params.pid);
  const run = Array.from(activeRuns.values()).find(r => r.pid === pid);
  
  if (!run || !run.running) {
    return reply.code(404).send({ error: "Run is not active or not found" });
  }

  try {
    process.kill(pid);
  } catch {}
  
  run.running = false;
  run.finishedAt = nowIso();
  run.logs.push(`[${nowIso()}] Stopped manually by user.`);
  
  return { ok: true, id: run.id };
});

app.post<{ Params: { id: string }; Body: { sessionProfile?: SessionProfileId } }>("/profiles/:id/start", async (request, reply) => {
  const { id } = request.params;
  const profiles = await loadProfiles();
  const profile = profiles.find((item) => item.id === id);

  if (!profile) {
    return reply.code(404).send({ error: "Profile not found" });
  }

  if (sessions.has(id)) {
    return reply.code(409).send({ error: "Profile is already running" });
  }

  // Lock: prevent parallel starts
  if (pendingProfileStarts.has(id)) {
    return reply.code(409).send({ error: "Profile start already in progress" });
  }

  pendingProfileStarts.add(id);

  try {
    const requestedSessionProfile = request.body?.sessionProfile ?? "auto";
    const sessionProfile = getSessionProfile(requestedSessionProfile, profile);
    const userDataDir = join(sessionRootDir, id);

    const parsedProxy = profile.proxy ? parseProxy(profile.proxy) : null;
    if (profile.proxy) {
      if (!parsedProxy || !supportedProxyProtocols.has(parsedProxy.protocol)) {
        return reply.code(400).send({ error: "Invalid proxy format. Use http/https/socks5://host:port" });
      }
      const health = await checkProxyReachable(profile.proxy);
      if (!health.ok) {
        return reply.code(400).send({
          error: `Proxy check failed: ${health.message}`,
        });
      }
    }

    await mkdir(userDataDir, { recursive: true });

    const args = [
      "--disable-blink-features=AutomationControlled",
      "--enforce-webrtc-ip-permission-check",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--disable-features=IsolateOrigins,site-per-process,TranslateUI,BlinkGenPropertyTrees",
    ];

    const proxy = parsedProxy
      ? {
          server: formatProxyForChrome(parsedProxy),
          username: parsedProxy.username,
          password: parsedProxy.password,
        }
      : undefined;

    const extensionDir = join(userDataDir, "profile-control-extension");
    await createControlExtension(extensionDir, parsedProxy ?? undefined);
    args.push(`--load-extension=${extensionDir}`);
    args.push(`--disable-extensions-except=${extensionDir}`);

    const customBrowserPath = process.env.CROMMINM_BROWSER_PATH;

    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
    try {
      const extraArgs = [
        ...args,
        `--force-cpu-count=${sessionProfile.hardwareConcurrency}`,
      ];

      // If you are using the local Go JA3/TLS proxy, you will need to ignore cert errors 
      // because the proxy does a local MITM to change the TLS fingerprint.
      // Uncomment the line below if you are running the TLS proxy.
      // extraArgs.push("--ignore-certificate-errors");

      if (sessionProfile.webgl) {
        extraArgs.push(`--fake-gpu-vendor=${sessionProfile.webgl.vendor}`);
        extraArgs.push(`--fake-gpu-renderer=${sessionProfile.webgl.renderer}`);
      }

      // Открываем порт для удаленного ручного управления
      const debugPort = Math.floor(Math.random() * (9999 - 9222 + 1) + 9222);
      extraArgs.push(`--remote-debugging-port=${debugPort}`);
      extraArgs.push(`--remote-debugging-address=0.0.0.0`);

      context = await chromium.launchPersistentContext(userDataDir, {
        executablePath: customBrowserPath || undefined,
        headless: process.env.HEADLESS === "true" ? true : false,
        proxy,
        locale: sessionProfile.locale,
        timezoneId: sessionProfile.timezoneId,
        userAgent: sessionProfile.userAgent,
        extraHTTPHeaders: sessionProfile.extraHTTPHeaders,
        viewport: sessionProfile.viewport,
        isMobile: sessionProfile.hasTouch,
        deviceScaleFactor: sessionProfile.deviceScaleFactor,
        hasTouch: sessionProfile.hasTouch,
        geolocation: sessionProfile.geolocation,
        args: extraArgs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot launch Playwright Chromium";
      return reply.code(500).send({
        error: message.includes("Executable doesn't exist")
          ? "Playwright Chromium is not installed. Run: npx playwright install chromium"
          : message,
      });
    }

    if (sessionProfile.geolocation) {
      await context.grantPermissions(["geolocation"]);
    }
    await addFingerprintInitScript(context, sessionProfile, profile.canvasNoiseSeed);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("about:blank");

    sessions.set(id, context);
    context.on("close", () => {
      sessions.delete(id);
    });

    return {
      ok: true,
      profileId: id,
      engine: "playwright-chromium",
      sessionProfile: sessionProfile.id,
      requestedSessionProfile,
    };
  } finally {
    // Always release lock
    pendingProfileStarts.delete(id);
  }
});

app.post<{ Params: { id: string } }>("/profiles/:id/stop", async (request, reply) => {
  const { id } = request.params;
  const session = sessions.get(id);

  if (!session) {
    return reply.code(404).send({ error: "Session is not running" });
  }

  await session.close();
  sessions.delete(id);

  return {
    ok: true,
    profileId: id,
  };
});

app.post("/shutdown", async (request, reply) => {
  app.log.info("Shutdown requested, closing all sessions...");
  
  const closePromises = Array.from(sessions.values()).map(async (session) => {
    try {
      await session.close();
    } catch (error) {
      app.log.error("Error closing session:", error);
    }
  });
  
  await Promise.all(closePromises);
  sessions.clear();
  
  app.log.info(`Closed ${closePromises.length} session(s)`);
  return { ok: true, closed: closePromises.length };
});

// ============================================
// Cookie Management Endpoints
// ============================================

app.get<{ Params: { id: string } }>("/profiles/:id/cookies", async (request, reply) => {
  const { id } = request.params;
  const profiles = await loadProfiles();
  const profile = profiles.find((item) => item.id === id);

  if (!profile) {
    return reply.code(404).send({ error: "Profile not found" });
  }

  const cookiesFile = join(sessionRootDir, id, "cookies.json");
  
  try {
    if (!existsSync(cookiesFile)) {
      return { cookies: [] };
    }
    
    const content = await readFile(cookiesFile, "utf-8");
    const cookies = parseJsonCookies(content);
    const filtered = filterExpiredCookies(cookies);
    
    return { cookies: filtered };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read cookies";
    return reply.code(500).send({ error: message });
  }
});

app.post<{ Params: { id: string }; Body: { cookies: Cookie[] } }>(
  "/profiles/:id/cookies",
  async (request, reply) => {
    const { id } = request.params;
    const { cookies } = request.body;
    
    if (!cookies || !Array.isArray(cookies)) {
      return reply.code(400).send({ error: "cookies array is required" });
    }
    
    const profiles = await loadProfiles();
    const profile = profiles.find((item) => item.id === id);

    if (!profile) {
      return reply.code(404).send({ error: "Profile not found" });
    }
    
    // Validate all cookies
    for (const cookie of cookies) {
      const validation = validateCookie(cookie);
      if (!validation.valid) {
        return reply.code(400).send({ error: `Invalid cookie: ${validation.errors.join(", ")}` });
      }
    }
    
    const cookiesDir = join(sessionRootDir, id);
    await mkdir(cookiesDir, { recursive: true });
    
    const cookiesFile = join(cookiesDir, "cookies.json");
    
    // Load existing cookies and merge
    let existingCookies: Cookie[] = [];
    if (existsSync(cookiesFile)) {
      try {
        const content = await readFile(cookiesFile, "utf-8");
        existingCookies = parseJsonCookies(content);
      } catch {
        // Ignore errors, start fresh
      }
    }
    
    const merged = mergeCookies(existingCookies, cookies);
    const filtered = filterExpiredCookies(merged);
    
    await writeFile(cookiesFile, exportJsonCookies(filtered), "utf-8");
    
    return { ok: true, count: filtered.length };
  }
);

app.delete<{
  Params: { id: string; name: string };
  Querystring: { domain?: string; path?: string; all?: string };
}>(
  "/profiles/:id/cookies/:name",
  async (request, reply) => {
    const { id, name } = request.params;
    const { domain, path: cookiePath, all } = request.query;
    const deleteAllWithName = all === "true" || all === "1";

    if (!deleteAllWithName && (domain === undefined || domain === "")) {
      return reply.code(400).send({
        error:
          "Query parameter 'domain' is required (use all=true to delete every cookie with this name).",
      });
    }

    const profiles = await loadProfiles();
    const profile = profiles.find((item) => item.id === id);

    if (!profile) {
      return reply.code(404).send({ error: "Profile not found" });
    }
    
    const cookiesFile = join(sessionRootDir, id, "cookies.json");
    
    if (!existsSync(cookiesFile)) {
      return reply.code(404).send({ error: "No cookies found for this profile" });
    }
    
    try {
      const content = await readFile(cookiesFile, "utf-8");
      let cookies = parseJsonCookies(content);
      
      cookies = cookies.filter((cookie) => {
        if (cookie.name !== name) return true;
        if (deleteAllWithName) return false;
        if (cookie.domain !== domain) return true;
        if (cookiePath !== undefined && cookiePath !== "" && cookie.path !== cookiePath) return true;
        return false;
      });
      
      await writeFile(cookiesFile, exportJsonCookies(cookies), "utf-8");
      
      return { ok: true, remaining: cookies.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete cookie";
      return reply.code(500).send({ error: message });
    }
  }
);

app.post<{ Params: { id: string }; Body: { content: string; format: CookieImportFormat; overwrite?: boolean } }>(
  "/profiles/:id/cookies/import",
  async (request, reply) => {
    const { id } = request.params;
    const { content, format, overwrite } = request.body;
    
    if (!content || !format) {
      return reply.code(400).send({ error: "content and format are required" });
    }
    
    const profiles = await loadProfiles();
    const profile = profiles.find((item) => item.id === id);

    if (!profile) {
      return reply.code(404).send({ error: "Profile not found" });
    }
    
    try {
      // Parse imported cookies
      let importedCookies: Cookie[];
      if (format === "netscape") {
        importedCookies = parseNetscapeCookies(content);
      } else if (format === "json") {
        importedCookies = parseJsonCookies(content);
      } else {
        return reply.code(400).send({ error: "Invalid format. Use 'json' or 'netscape'" });
      }
      
      // Validate all cookies
      for (const cookie of importedCookies) {
        const validation = validateCookie(cookie);
        if (!validation.valid) {
          return reply.code(400).send({ error: `Invalid cookie: ${validation.errors.join(", ")}` });
        }
      }
      
      const cookiesDir = join(sessionRootDir, id);
      await mkdir(cookiesDir, { recursive: true });
      
      const cookiesFile = join(cookiesDir, "cookies.json");
      
      let finalCookies: Cookie[];
      
      if (overwrite) {
        finalCookies = importedCookies;
      } else {
        // Merge with existing
        let existingCookies: Cookie[] = [];
        if (existsSync(cookiesFile)) {
          try {
            const existingContent = await readFile(cookiesFile, "utf-8");
            existingCookies = parseJsonCookies(existingContent);
          } catch {
            // Ignore errors
          }
        }
        finalCookies = mergeCookies(existingCookies, importedCookies);
      }
      
      const filtered = filterExpiredCookies(finalCookies);
      await writeFile(cookiesFile, exportJsonCookies(filtered), "utf-8");
      
      return { ok: true, imported: importedCookies.length, total: filtered.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import cookies";
      return reply.code(500).send({ error: message });
    }
  }
);

app.get<{ Params: { id: string }; Querystring: { format?: CookieExportFormat } }>(
  "/profiles/:id/cookies/export",
  async (request, reply) => {
    const { id } = request.params;
    const { format } = request.query;
    
    const profiles = await loadProfiles();
    const profile = profiles.find((item) => item.id === id);

    if (!profile) {
      return reply.code(404).send({ error: "Profile not found" });
    }
    
    const cookiesFile = join(sessionRootDir, id, "cookies.json");
    
    if (!existsSync(cookiesFile)) {
      return reply.code(404).send({ error: "No cookies found for this profile" });
    }
    
    try {
      const content = await readFile(cookiesFile, "utf-8");
      const cookies = parseJsonCookies(content);
      const filtered = filterExpiredCookies(cookies);
      
      const exportFormat = format || "json";
      
      if (exportFormat === "netscape") {
        const exported = exportNetscapeCookies(filtered);
        return { format: "netscape", content: exported, count: filtered.length };
      } else {
        const exported = exportJsonCookies(filtered);
        return { format: "json", content: exported, count: filtered.length };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to export cookies";
      return reply.code(500).send({ error: message });
    }
  }
);

app.post<{ Body: { os?: string; deviceType?: string; location?: string } }>(
  "/profiles/generate-fingerprint",
  async (request, reply) => {
    try {
      const { os, deviceType, location } = request.body;
      
      const fingerprint = await generateFingerprint({
        os: os as "windows" | "macos" | "android" | "ios" | "linux" | undefined,
        deviceType: deviceType as "desktop" | "mobile" | "tablet" | undefined,
        location,
      });
      
      // Validate consistency
      const validation = validateFingerprintConsistency(fingerprint);
      if (!validation.valid) {
        app.log.warn("Generated fingerprint has consistency issues:", validation.errors);
      }
      
      return {
        ok: true,
        fingerprint,
        validation,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate fingerprint";
      return reply.code(500).send({ error: message });
    }
  }
);

// --- Fingerprint Collector Routes ---

app.get("/collector", async (request, reply) => {
  reply.type("text/html").send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Cromminm Fingerprint Collector</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; max-width: 600px; margin: 0 auto; line-height: 1.5; }
    #status { padding: 1rem; border-radius: 4px; background: #f0f0f0; margin-bottom: 1rem; }
    .success { background: #d4edda !important; color: #155724; }
    .error { background: #f8d7da !important; color: #721c24; }
    pre { background: #222; color: #0f0; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Fingerprint Collector</h1>
  <div id="status">Collecting data... please wait.</div>
  <pre id="output"></pre>

  <script>
    (async function() {
      const statusEl = document.getElementById('status');
      const outputEl = document.getElementById('output');
      
      try {
        const fp = {};
        
        // 1. Basic Info
        fp.userAgent = navigator.userAgent;
        fp.language = navigator.language;
        fp.languages = navigator.languages ? [...navigator.languages] : [navigator.language];
        fp.platform = navigator.platform;
        fp.hardwareConcurrency = navigator.hardwareConcurrency || 2;
        fp.deviceMemory = navigator.deviceMemory || 4;
        fp.maxTouchPoints = navigator.maxTouchPoints || 0;
        fp.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        fp.timezoneOffset = new Date().getTimezoneOffset();
        
        // 2. Screen & Viewport
        fp.screen = {
          width: window.screen.width,
          height: window.screen.height,
          availWidth: window.screen.availWidth,
          availHeight: window.screen.availHeight,
          colorDepth: window.screen.colorDepth,
          pixelDepth: window.screen.pixelDepth
        };
        fp.viewport = {
          width: window.innerWidth,
          height: window.innerHeight
        };
        
        // 3. Client Hints
        if (navigator.userAgentData) {
          try {
            const highEntropy = await navigator.userAgentData.getHighEntropyValues([
              'architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'formFactors'
            ]);
            fp.clientHints = {
              platform: navigator.userAgentData.platform,
              mobile: navigator.userAgentData.mobile,
              brands: navigator.userAgentData.brands,
              ...highEntropy
            };
          } catch(e) {}
        }
        
        // 4. WebGL
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
          const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
          fp.webgl = {
            vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
            renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            version: gl.getParameter(gl.VERSION),
            shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            maxViewportDimensions: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS))
          };
        }
        
        // 5. AudioContext
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) {
            const audioCtx = new AudioContext();
            fp.audioContext = {
              sampleRate: audioCtx.sampleRate,
              maxChannelCount: audioCtx.destination.maxChannelCount,
              numberOfInputs: audioCtx.destination.numberOfInputs,
              numberOfOutputs: audioCtx.destination.numberOfOutputs,
              channelCount: audioCtx.destination.channelCount
            };
          }
        } catch(e) {}
        
        // 6. Determine OS & Device
        let os = 'unknown';
        if (fp.userAgent.includes('Windows')) os = 'windows';
        else if (fp.userAgent.includes('Mac OS X') && !fp.userAgent.includes('iPhone') && !fp.userAgent.includes('iPad')) os = 'macos';
        else if (fp.userAgent.includes('Android')) os = 'android';
        else if (fp.userAgent.includes('iPhone') || fp.userAgent.includes('iPad')) os = 'ios';
        else if (fp.userAgent.includes('Linux')) os = 'linux';
        
        let deviceType = 'desktop';
        if (fp.maxTouchPoints > 0 && (os === 'android' || os === 'ios')) deviceType = 'mobile';
        
        fp.os = os;
        fp.deviceType = deviceType;
        
        outputEl.textContent = JSON.stringify(fp, null, 2);
        
        // 7. Send to server
        const res = await fetch('/api/fingerprints/collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fp)
        });
        
        if (res.ok) {
          statusEl.textContent = 'Fingerprint successfully collected and saved!';
          statusEl.className = 'success';
        } else {
          throw new Error('Server returned ' + res.status);
        }
      } catch (err) {
        statusEl.textContent = 'Error: ' + err.message;
        statusEl.className = 'error';
        console.error(err);
      }
    })();
  </script>
</body>
</html>
  `);
});

app.post("/api/fingerprints/collect", async (request, reply) => {
  try {
    const fp = request.body as any;
    const os = fp.os || 'windows';
    const deviceType = fp.deviceType || 'desktop';
    const poolKey = \`\${os}_\${deviceType}\`;
    
    const dbPath = join(rootDir, "..", "shared", "fingerprints.json");
    let db = { version: "1.0", lastUpdated: new Date().toISOString(), fingerprints: { windows_desktop: [], macos_desktop: [], android_mobile: [] } };
    
    if (existsSync(dbPath)) {
      db = JSON.parse(await readFile(dbPath, "utf-8"));
    }
    
    if (!db.fingerprints[poolKey]) {
      db.fingerprints[poolKey] = [];
    }
    
    // Prevent exactly identical basic duplicates
    const exists = db.fingerprints[poolKey].find((existing: any) => 
      existing.userAgent === fp.userAgent && 
      existing.screen?.width === fp.screen?.width &&
      existing.webgl?.renderer === fp.webgl?.renderer
    );
    
    if (!exists) {
      db.fingerprints[poolKey].push(fp);
      db.lastUpdated = new Date().toISOString();
      await writeFile(dbPath, JSON.stringify(db, null, 2), "utf-8");
      app.log.info(\`Saved new \${poolKey} fingerprint to pool\`);
    } else {
      app.log.info(\`Fingerprint already exists in \${poolKey} pool, skipped\`);
    }
    
    return { ok: true };
  } catch (error) {
    app.log.error(error);
    return reply.code(500).send({ error: "Failed to save fingerprint" });
  }
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(async () => {
  app.log.info(`Local API is running on http://0.0.0.0:${PORT}`);
  
  // Health check: verify Playwright browser is installed
  try {
    const executablePath = chromium.executablePath();
    if (!existsSync(executablePath)) {
      app.log.warn("Playwright Chromium not found. Run: npx playwright install chromium");
    } else {
      app.log.info("Playwright Chromium is installed");
    }
  } catch (error) {
    app.log.warn("Could not verify Playwright installation:", error);
  }
}).catch((error) => {
  if (error.code === 'EADDRINUSE') {
    app.log.error(`Port ${PORT} is already in use. Please close the other application or change the port.`);
    process.exit(1);
  }
  throw error;
});
