import "dotenv/config";
import path from "node:path";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { getSessionProfile } from "./sessionProfiles.mjs";

chromium.use(StealthPlugin());

const now = () => new Date().toISOString();

const isProd = process.env.NODE_ENV === 'production';
const rootDir = isProd && process.resourcesPath 
  ? path.join(process.resourcesPath, 'app') 
  : process.cwd();

const automationDir = path.join(rootDir, "automation");
const dataDir = path.join(rootDir, "data");

const requiredFlag = process.env.ALLOW_AUTOMATION === "true";
if (!requiredFlag) {
  console.error(
    "[safety] Set ALLOW_AUTOMATION=true in .env to run allowed automation scenarios.",
  );
  process.exit(1);
}

const BASE_URL = process.env.BASE_URL ?? "https://example.com";
const HEADLESS = (process.env.HEADLESS ?? "true") === "true" && process.env.INTERACTIVE_DEBUG !== "true";
const INTERACTIVE_DEBUG = process.env.INTERACTIVE_DEBUG === "true";
const PROXY_URL = process.env.PROXY_URL?.trim();
const SESSION_PROFILE = process.env.SESSION_PROFILE ?? "desktop_en";
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? "2");
const SCENARIO = process.env.SCENARIO ?? "visit";
const STORAGE_STATE = process.env.STORAGE_STATE ?? path.join(automationDir, "state", "storageState.json");
const SEARCH_SELECTOR =
  process.env.SEARCH_SELECTOR ?? "input[type='search'], input[name='q'], input[type='text']";
const SEARCH_TEXT = process.env.SEARCH_TEXT?.trim();
const CLICK_SELECTOR = process.env.CLICK_SELECTOR?.trim();
const ACTION_PAUSE_MIN_MS = Number(process.env.ACTION_PAUSE_MIN_MS ?? "120");
const ACTION_PAUSE_MAX_MS = Number(process.env.ACTION_PAUSE_MAX_MS ?? "350");
const TYPE_MIN_MS = Number(process.env.TYPE_MIN_MS ?? "55");
const TYPE_MAX_MS = Number(process.env.TYPE_MAX_MS ?? "185");
const VIEWPORT_TIMEOUT_MS = Number(process.env.VIEWPORT_TIMEOUT_MS ?? "10000");
const READING_DURATION_MS = Number(process.env.READING_DURATION_MS ?? "0");
const sessionProfile = getSessionProfile(SESSION_PROFILE);
const parseFiniteNumber = (raw, fallback) => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const DEVICE_SCALE_FACTOR = Number(
  process.env.DEVICE_SCALE_FACTOR ?? String(sessionProfile.deviceScaleFactor ?? 1),
);
const HAS_TOUCH = (process.env.HAS_TOUCH ?? String(sessionProfile.hasTouch ?? false)) === "true";
const HARDWARE_CONCURRENCY = Number(
  process.env.HARDWARE_CONCURRENCY ?? String(sessionProfile.hardwareConcurrency ?? 8),
);
const DEVICE_MEMORY = Number(process.env.DEVICE_MEMORY ?? String(sessionProfile.deviceMemory ?? 8));
const GEO_LAT = parseFiniteNumber(
  process.env.GEO_LAT ?? String(sessionProfile.geolocation?.latitude ?? NaN),
  NaN,
);
const GEO_LON = parseFiniteNumber(
  process.env.GEO_LON ?? String(sessionProfile.geolocation?.longitude ?? NaN),
  NaN,
);
const GEO_ACCURACY = parseFiniteNumber(
  process.env.GEO_ACCURACY ?? String(sessionProfile.geolocation?.accuracy ?? 100),
  100,
);
const HAS_GEOLOCATION = Number.isFinite(GEO_LAT) && Number.isFinite(GEO_LON);
const GEO_ORIGIN = (() => {
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return BASE_URL;
  }
})();

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(automationDir, "output", runId);
const logFile = path.join(outputDir, "run.log");
const screenshotFile = path.join(outputDir, "final.png");
const reportFile = path.join(outputDir, "report.json");
const sessionDataDir = path.join(automationDir, "sessions", SESSION_PROFILE, runId);

const report = {
  runId,
  scenario: SCENARIO,
  sessionProfile: SESSION_PROFILE,
  baseUrl: BASE_URL,
  startedAt: now(),
  finishedAt: "",
  success: false,
  attempts: 0,
  outputDir,
  logFile,
  screenshotFile,
  reportFile,
  session: {
    userDataDir: sessionDataDir,
    locale: sessionProfile.locale,
    timezoneId: sessionProfile.timezoneId,
    viewport: sessionProfile.viewport,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    hasTouch: HAS_TOUCH,
    hardwareConcurrency: HARDWARE_CONCURRENCY,
    deviceMemory: DEVICE_MEMORY,
    geolocation: HAS_GEOLOCATION
      ? {
          latitude: GEO_LAT,
          longitude: GEO_LON,
          accuracy: GEO_ACCURACY,
        }
      : null,
    userAgent: sessionProfile.userAgent,
    proxy: PROXY_URL ?? null,
  },
  environment: {
    headless: HEADLESS,
    maxAttempts: MAX_ATTEMPTS,
  },
  metrics: {
    actionCount: 0,
    typedCharacters: 0,
    totalActionMs: 0,
    hoverCount: 0,
    clickCount: 0,
    waitVisibleCount: 0,
    readIterations: 0,
  },
  errors: [],
  timeline: [],
  steps: [],
};

await mkdir(outputDir, { recursive: true });
await mkdir(path.dirname(path.resolve(STORAGE_STATE)), { recursive: true });
await mkdir(sessionDataDir, { recursive: true });

const appendLog = async (line, level = "info") => {
  const full = `[${now()}] ${line}`;
  report.timeline.push({
    time: now(),
    level,
    message: line,
  });
  console.log(full);
  await writeFile(logFile, `${full}\n`, { encoding: "utf-8", flag: "a" });
};

const step = async (name, status, details, durationMs) => {
  report.steps.push({
    time: now(),
    name,
    status,
    details,
    durationMs: typeof durationMs === "number" ? durationMs : undefined,
  });
  await appendLog(`${name}: ${status}${details ? ` (${details})` : ""}`);
};

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const backoffMs = (attempt) => 1500 * attempt;
const randomInt = (min, max) =>
  Math.floor(Math.random() * (Math.max(min, max) - Math.min(min, max) + 1)) +
  Math.min(min, max);

const randomPause = async (minMs, maxMs) => {
  const ms = randomInt(minMs, maxMs);
  await sleep(ms);
  report.metrics.totalActionMs += ms;
  return ms;
};

const ensureVisible = async (page, selector) => {
  const started = Date.now();
  await page.waitForSelector(selector, {
    state: "visible",
    timeout: VIEWPORT_TIMEOUT_MS,
  });
  await page.locator(selector).scrollIntoViewIfNeeded();
  report.metrics.waitVisibleCount += 1;
  return Date.now() - started;
};

let lastMouse = { x: 0, y: 0 };
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

const moveMouseWithEase = async (page, targetX, targetY, totalSteps) => {
  const startX = lastMouse.x;
  const startY = lastMouse.y;
  for (let i = 1; i <= totalSteps; i++) {
    const t = i / totalSteps;
    const easedT = easeInOutSine(t);
    const currentX = startX + (targetX - startX) * easedT;
    const currentY = startY + (targetY - startY) * easedT;
    await page.mouse.move(currentX, currentY);
    await sleep(randomInt(2, 5));
  }
  lastMouse.x = targetX;
  lastMouse.y = targetY;
};

const bezierHover = async (page, selector) => {
  const locator = typeof selector === "string" ? page.locator(selector) : selector;
  const box = await locator.boundingBox();
  if (!box) {
    await locator.hover();
    return;
  }
  const targetX = box.x + box.width / 2 + randomInt(-box.width/4, box.width/4);
  const targetY = box.y + box.height / 2 + randomInt(-box.height/4, box.height/4);
  
  // Micro-jitter near the target before clicking
  const jitterX = targetX + randomInt(-10, 10);
  const jitterY = targetY + randomInt(-10, 10);
  
  await moveMouseWithEase(page, jitterX, jitterY, randomInt(15, 30));
  await sleep(randomInt(30, 80));
  await moveMouseWithEase(page, targetX, targetY, randomInt(5, 10));
};

const safeClick = async (page, selector) => {
  const started = Date.now();
  const locator = typeof selector === "string" ? page.locator(selector) : selector;
  
  // Wait visible manually if it's a string, or just wait for locator
  if (typeof selector === "string") {
    await ensureVisible(page, selector);
  } else {
    await locator.scrollIntoViewIfNeeded();
  }
  
  // Use Bezier/Jitter hover
  await bezierHover(page, selector);
  report.metrics.hoverCount += 1;
  const pause = await randomPause(ACTION_PAUSE_MIN_MS, ACTION_PAUSE_MAX_MS);
  
  await locator.click();
  const elapsed = Date.now() - started;
  report.metrics.actionCount += 1;
  report.metrics.clickCount += 1;
  await step(
    "action.click",
    "ok",
    `visible checked; pause=${pause}ms; elapsed=${elapsed}ms`,
    elapsed,
  );
};

const humanType = async (page, selector, text) => {
  const started = Date.now();
  const visibleMs = await ensureVisible(page, selector);
  await safeClick(page, selector);
  let totalKeyDelay = 0;
  
  const qwertyAdjacent = {
    'a': 'sqw', 'b': 'vghn', 'c': 'xdfv', 'd': 'sxcf', 'e': 'wrds', 'f': 'drtgv', 'g': 'ftyhb', 'h': 'gyujn', 'i': 'uokj', 'j': 'huikm', 'k': 'jiolm', 'l': 'kop', 'm': 'njk', 'n': 'bhjm', 'o': 'ikp', 'p': 'ol', 'q': 'wa', 'r': 'etdf', 's': 'awedxz', 't': 'ryfg', 'u': 'yihj', 'v': 'cfgb', 'w': 'qeas', 'x': 'zsdc', 'y': 'tugh', 'z': 'asx'
  };

  for (const char of text) {
    // Typos (3% chance)
    const lowerChar = char.toLowerCase();
    if (qwertyAdjacent[lowerChar] && Math.random() < 0.03) {
      const adjacent = qwertyAdjacent[lowerChar];
      const typoChar = adjacent[Math.floor(Math.random() * adjacent.length)];
      const typoDelay = randomInt(TYPE_MIN_MS, TYPE_MAX_MS);
      await page.keyboard.type(char === lowerChar ? typoChar : typoChar.toUpperCase(), { delay: typoDelay });
      totalKeyDelay += typoDelay;
      await sleep(randomInt(150, 350));
      await page.keyboard.press("Backspace");
      await sleep(randomInt(100, 200));
    }
    
    const delay = randomInt(TYPE_MIN_MS, TYPE_MAX_MS);
    await page.keyboard.type(char, { delay });
    report.metrics.typedCharacters += 1;
    totalKeyDelay += delay;
  }
  const elapsed = Date.now() - started;
  report.metrics.actionCount += 1;
  await step(
    "action.type",
    "ok",
    `${selector}; visible=${visibleMs}ms; chars=${text.length}; keyDelay=${totalKeyDelay}ms; elapsed=${elapsed}ms`,
    elapsed,
  );
};

const highlightText = async (page) => {
  try {
    const paragraphs = await page.$$('p');
    if (paragraphs.length > 0) {
      const element = paragraphs[Math.floor(Math.random() * paragraphs.length)];
      const box = await element.boundingBox();
      if (box) {
        await moveMouseWithEase(page, box.x + 10, box.y + 10, randomInt(15, 25));
        await page.mouse.down();
        await moveMouseWithEase(page, box.x + box.width / 2, box.y + 10, randomInt(20, 40));
        await page.mouse.up();
        await randomPause(500, 1500);
        // Click elsewhere to unhighlight
        await moveMouseWithEase(page, box.x + box.width / 2, box.y + box.height + 20, randomInt(10, 20));
        await page.mouse.down();
        await page.mouse.up();
      }
    }
  } catch (err) {
    // Ignore
  }
};

const simulateReading = async (page, durationMs) => {
  const started = Date.now();
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  let loops = 0;

  while (Date.now() - started < durationMs) {
    loops += 1;
    
    const randomAction = Math.random();
    
    // Idle Activity (15% chance)
    if (randomAction < 0.15) {
      const x = randomInt(viewport.width * 0.1, viewport.width * 0.9);
      const y = randomInt(viewport.height * 0.1, viewport.height * 0.9);
      await moveMouseWithEase(page, x, y, randomInt(30, 60));
      await randomPause(400, 1000);
    } 
    // Highlight Text (10% chance)
    else if (randomAction < 0.25) {
      await highlightText(page);
    }
    // Normal scroll
    else {
      const x = randomInt(40, Math.max(60, viewport.width - 40));
      const y = randomInt(120, Math.max(140, viewport.height - 50));
      await moveMouseWithEase(page, x, y, randomInt(15, 30));
      
      // Smart scrolling: speed depends on random factor imitating text density
      const deltaY = randomInt(100, 400); // mostly scroll down
      const scrollSteps = randomInt(5, 25);
      const stepY = deltaY / scrollSteps;
      for (let i = 0; i < scrollSteps; i++) {
        await page.mouse.wheel(0, stepY);
        await sleep(randomInt(10, 40));
      }
      await randomPause(300, 800);
    }
  }

  report.metrics.readIterations += loops;
  await step("action.reading", "ok", `duration=${durationMs}ms; loops=${loops}`, Date.now() - started);
};

const writeReport = async () => {
  report.finishedAt = now();
  await writeFile(reportFile, JSON.stringify(report, null, 2), "utf-8");
};

const robotsAllowsRun = async () => {
  try {
    const robotsUrl = new URL("/robots.txt", BASE_URL).toString();
    const response = await fetch(robotsUrl);
    if (!response.ok) {
      await appendLog(`robots.txt unavailable (${response.status}), continue with caution`);
      return true;
    }

    const content = await response.text();
    const disallowAll = /User-agent:\s*\*\s*[\s\S]*?Disallow:\s*\/\s*$/im.test(content);
    if (disallowAll) {
      await appendLog("robots.txt disallow-all detected, stop run");
      return false;
    }
    return true;
  } catch {
    await appendLog("Cannot read robots.txt, continue with caution");
    return true;
  }
};

const customBrowserPath = process.env.CROMMINM_BROWSER_PATH;

const runAttempt = async (attempt) => {
  const extraArgs = [
      '--disable-blink-features=AutomationControlled',
      '--enforce-webrtc-ip-permission-check',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-features=IsolateOrigins,site-per-process,TranslateUI,BlinkGenPropertyTrees', // Gen-1: Deep leak fix
      '--tls13-variant=draft23', // Gen-1: Structural TLS mimic
      `--force-cpu-count=${HARDWARE_CONCURRENCY}`,
  ];

  if (sessionProfile.webgl) {
      extraArgs.push(`--fake-gpu-vendor=${sessionProfile.webgl.vendor}`);
      extraArgs.push(`--fake-gpu-renderer=${sessionProfile.webgl.renderer}`);
  }

  const context = await chromium.launchPersistentContext(sessionDataDir, {
    executablePath: customBrowserPath || undefined,
    headless: HEADLESS,
    proxy: PROXY_URL ? { server: PROXY_URL } : undefined,
    locale: sessionProfile.locale,
    timezoneId: sessionProfile.timezoneId,
    userAgent: sessionProfile.userAgent,
    extraHTTPHeaders: sessionProfile.extraHTTPHeaders,
    viewport: sessionProfile.viewport,
    isMobile: HAS_TOUCH,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    hasTouch: HAS_TOUCH,
    geolocation: HAS_GEOLOCATION
      ? {
          latitude: GEO_LAT,
          longitude: GEO_LON,
          accuracy: GEO_ACCURACY,
        }
      : undefined,
    args: extraArgs,
  });

  try {
    if (HAS_GEOLOCATION) {
      await context.grantPermissions(["geolocation"], { origin: GEO_ORIGIN });
      await step("geolocation", "ok", `lat=${GEO_LAT}; lon=${GEO_LON}; acc=${GEO_ACCURACY}`);
    }

    await context.addInitScript(
      (payload) => {
        Object.defineProperty(navigator, "hardwareConcurrency", {
          configurable: true,
          get: () => payload.hardwareConcurrency,
        });
        Object.defineProperty(navigator, "deviceMemory", {
          configurable: true,
          get: () => payload.deviceMemory,
        });

        // --- MODULE 1: Client Hints (Full) ---
        if (navigator.userAgentData) {
          const isMobile = payload.hasTouch;
          const platform = payload.clientHints.platform;
          const brands = [
            { brand: "Not.A/Brand", version: "8" },
            { brand: "Chromium", version: payload.clientHints.majorVersion },
            { brand: "Google Chrome", version: payload.clientHints.majorVersion }
          ];
          
          Object.defineProperty(navigator.userAgentData, 'mobile', { get: () => isMobile });
          Object.defineProperty(navigator.userAgentData, 'platform', { get: () => platform });
          Object.defineProperty(navigator.userAgentData, 'brands', { get: () => brands });
          
          navigator.userAgentData.getHighEntropyValues = async (hints) => {
            const result = {
              mobile: isMobile,
              platform: platform,
              brands: brands,
              formFactors: payload.clientHints.formFactors,
            };
            if (hints.includes('platformVersion')) result.platformVersion = payload.clientHints.platformVersion;
            if (hints.includes('architecture')) result.architecture = payload.clientHints.architecture;
            if (hints.includes('model')) result.model = payload.clientHints.model;
            if (hints.includes('bitness')) result.bitness = payload.clientHints.bitness;
            if (hints.includes('uaFullVersion')) result.uaFullVersion = payload.clientHints.fullVersion;
            if (hints.includes('fullVersionList')) {
              result.fullVersionList = brands.map((item) => ({
                ...item,
                version: item.brand === "Not.A/Brand" ? "8.0.0.0" : payload.clientHints.fullVersion,
              }));
            }
            return result;
          };
        }

        // --- MODULE 1: Canvas & WebGL Noise ---
        const seedStr = payload.canvasNoiseSeed || payload.runId;
        const seed = seedStr.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
        let currentSeed = Math.abs(seed);
        const pseudoRandom = () => {
          currentSeed = (currentSeed * 9301 + 49297) % 233280;
          return currentSeed / 233280;
        };

        const addNoise = (canvas) => {
          const shift = {
            r: Math.floor(pseudoRandom() * 10) - 5,
            g: Math.floor(pseudoRandom() * 10) - 5,
            b: Math.floor(pseudoRandom() * 10) - 5,
            a: Math.floor(pseudoRandom() * 10) - 5
          };
          const width = canvas.width;
          const height = canvas.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const imageData = ctx.getImageData(0, 0, width, height);
          for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
              const n = (i * width + j) * 4;
              imageData.data[n] = imageData.data[n] + shift.r;
              imageData.data[n + 1] = imageData.data[n + 1] + shift.g;
              imageData.data[n + 2] = imageData.data[n + 2] + shift.b;
              imageData.data[n + 3] = imageData.data[n + 3] + shift.a;
            }
          }
          ctx.putImageData(imageData, 0, 0);
        };
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(...args) {
          addNoise(this);
          return origToDataURL.apply(this, args);
        };
        
        const origGetParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          const UNMASKED_VENDOR_WEBGL = 37445;
          const UNMASKED_RENDERER_WEBGL = 37446;
          if (payload.webgl) {
            if (parameter === UNMASKED_VENDOR_WEBGL) return payload.webgl.vendor;
            if (parameter === UNMASKED_RENDERER_WEBGL) return payload.webgl.renderer;
            if (parameter === 3379) return payload.webgl.maxTextureSize;
            if (parameter === 3386) return new Int32Array(payload.webgl.maxViewportDimensions);
          }
          return origGetParameter.call(this, parameter);
        };
        
        const origGetExtension = WebGLRenderingContext.prototype.getExtension;
        WebGLRenderingContext.prototype.getExtension = function(name) {
          const ext = origGetExtension.call(this, name);
          if (name === 'WEBGL_debug_renderer_info') {
             return {
                UNMASKED_VENDOR_WEBGL: 37445,
                UNMASKED_RENDERER_WEBGL: 37446
             };
          }
          return ext;
        };
        
        // --- MODULE 1: Font Fingerprint Masking ---
        const origMeasureText = CanvasRenderingContext2D.prototype.measureText;
        CanvasRenderingContext2D.prototype.measureText = function(...args) {
          const result = origMeasureText.apply(this, args);
          const shift = pseudoRandom() * 0.001; // slight random shift
          Object.defineProperty(result, 'width', { get: () => result.width + shift });
          return result;
        };

        // --- MODULE 1: AudioContext Spoofing ---
        if (window.AudioBuffer) {
          const origGetChannelData = AudioBuffer.prototype.getChannelData;
          AudioBuffer.prototype.getChannelData = function(...args) {
            const result = origGetChannelData.apply(this, args);
            for (let i = 0; i < result.length; i += 100) {
              result[i] = result[i] + (pseudoRandom() * 0.0001);
            }
            return result;
          };
        }

        // --- MODULE GENESIS 2: Deep Chromium Leaks ---
        window.chrome = {
          app: {
            isInstalled: false,
            InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
            RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" }
          },
          runtime: {
            OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", SHARED_MODULE_UPDATE: "shared_module_update", UPDATE: "update" },
            OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
            PlatformArch: { ARM: "arm", ARM64: "arm64", MIPS: "mips", MIPS64: "mips64", X86_32: "x86_32", X86_64: "x86_64" },
            PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
            RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" }
          },
          loadTimes: function() {
            return {
              requestTime: performance.timing.navigationStart / 1000,
              startLoadTime: performance.timing.navigationStart / 1000,
              commitLoadTime: performance.timing.responseStart / 1000,
              finishDocumentLoadTime: performance.timing.domContentLoadedEventEnd / 1000,
              finishLoadTime: performance.timing.loadEventEnd / 1000,
              firstPaintTime: performance.timing.domInteractive / 1000,
              firstPaintAfterLoadTime: 0,
              navigationType: "Other",
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true,
              npnNegotiatedProtocol: "h2",
              wasAlternateProtocolAvailable: false,
              connectionInfo: "h2"
            };
          },
          csi: function() {
            return {
              startE: performance.timing.navigationStart,
              onloadT: performance.timing.domContentLoadedEventEnd,
              pageT: performance.timing.loadEventEnd - performance.timing.navigationStart,
              tran: 15
            };
          }
        };

        // --- MODULE GENESIS 3: Mobile Sensor Fusion & Battery ---
        if (payload.hasTouch) {
          let batteryLevel = 0.85 + (pseudoRandom() * 0.1);
          let isCharging = new Date().getHours() < 12;
          const batteryPromise = Promise.resolve({
            level: batteryLevel,
            charging: isCharging,
            chargingTime: isCharging ? 1800 : Infinity,
            dischargingTime: isCharging ? Infinity : 14400,
            addEventListener: function() {}
          });
          navigator.getBattery = () => batteryPromise;

          setInterval(() => {
            if (document.hidden) return;
            try {
              const motionEvent = new Event('devicemotion');
              motionEvent.acceleration = { x: pseudoRandom() * 0.1, y: pseudoRandom() * 0.1, z: pseudoRandom() * 0.1 };
              motionEvent.accelerationIncludingGravity = { x: pseudoRandom() * 0.1, y: 9.8 + pseudoRandom() * 0.1, z: pseudoRandom() * 0.1 };
              motionEvent.rotationRate = { alpha: pseudoRandom() * 0.1, beta: pseudoRandom() * 0.1, gamma: pseudoRandom() * 0.1 };
              motionEvent.interval = 16;
              window.dispatchEvent(motionEvent);

              const orientationEvent = new Event('deviceorientation');
              orientationEvent.alpha = pseudoRandom() * 360;
              orientationEvent.beta = (pseudoRandom() * 180) - 90;
              orientationEvent.gamma = (pseudoRandom() * 180) - 90;
              window.dispatchEvent(orientationEvent);
            } catch (e) {}
          }, 1000);
        }
      },
      {
        hardwareConcurrency: HARDWARE_CONCURRENCY,
        deviceMemory: DEVICE_MEMORY,
        hasTouch: HAS_TOUCH,
        clientHints: sessionProfile.clientHints,
        webgl: sessionProfile.webgl,
        canvasNoiseSeed: sessionProfile.canvasNoiseSeed,
      },
    );

    const page = context.pages()[0] ?? (await context.newPage());

    // --- MODULE 4: Health Check (Reputation Monitoring) ---
    if (process.env.HEALTH_CHECK === "true") {
      await step("health_check", "start", "Checking pixelscan.io");
      try {
        await page.goto("https://pixelscan.io/", { waitUntil: "domcontentloaded", timeout: 45000 });
        await randomPause(3000, 5000);
        const content = await page.content();
        if (content.toLowerCase().includes("inconsistent") || content.toLowerCase().includes("bot")) {
          await step("health_check", "failed", "low_trust detected");
          throw new Error("Health check failed: low_trust");
        }
        await step("health_check", "ok", "passed");
      } catch (err) {
        if (err.message.includes("low_trust")) throw err;
        await step("health_check", "warn", "Could not load pixelscan.io completely, continuing");
      }
    }

    if (SCENARIO === "warmup") {
      // --- MODULE 4: Cookie Farming (Warmup) ---
      await step("scenario.warmup", "start", "starting cookie farming");
      let whiteList = [];
      try {
         whiteList = JSON.parse(await readFile(path.resolve("data", "white_list.json"), "utf8"));
      } catch {
         whiteList = ["https://en.wikipedia.org/wiki/Main_Page", "https://www.reddit.com/", "https://www.youtube.com/"];
      }
      
      const numSites = randomInt(3, 5);
      const sites = whiteList.sort(() => 0.5 - Math.random()).slice(0, numSites);
      
      for (const site of sites) {
        await step("warmup", "visit", site);
        try {
          await page.goto(site, { waitUntil: "domcontentloaded", timeout: 45000 });
          await simulateReading(page, randomInt(30000, 60000));
          
          // --- MODULE GENESIS 5: Auto-History (Social Graph & Ad Interest) ---
          await appendLog(`Generating history/ad profile on ${site}...`);
          if (site.includes("wikipedia.org")) {
            const searchTerms = ["History of Earth", "Quantum mechanics", "Javascript", "Web scraping"];
            const term = searchTerms[randomInt(0, searchTerms.length - 1)];
            const searchInput = await page.$('input[name="search"]');
            if (searchInput) {
               await humanType(page, searchInput, term);
               await page.keyboard.press("Enter");
               await randomPause(2000, 4000);
               await simulateReading(page, randomInt(20000, 40000));
            }
          } else if (site.includes("reddit.com")) {
             const links = await page.$$('a[data-testid="post-title"], a.title');
             if (links.length > 0) {
                const link = links[randomInt(0, Math.min(5, links.length - 1))];
                if (await link.isVisible()) {
                  await safeClick(page, link);
                  await randomPause(2000, 4000);
                  await simulateReading(page, randomInt(20000, 40000));
                }
             }
          } else {
             // Click any plausible article/content link
             const links = await page.$$('a');
             if (links.length > 20) {
                const link = links[randomInt(10, Math.min(30, links.length - 1))];
                if (await link.isVisible()) {
                   await safeClick(page, link);
                   await randomPause(2000, 4000);
                   await simulateReading(page, randomInt(20000, 40000));
                }
             }
          }
        } catch (err) {
          await appendLog(`Failed to warmup on ${site}: ${err.message}`);
        }
      }
      await step("scenario.warmup", "ok", `warmed up on ${sites.length} sites`);
    } else if (SCENARIO === "ai-explore") {
      // --- MODULE 4: AI Vision ---
      await step("scenario.ai-explore", "start", "AI vision taking control");
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required for ai-explore");
      
      await step("navigate", "start", `attempt=${attempt}; url=${BASE_URL}`);
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      await randomPause(2000, 4000);
      
      const screenshot = await page.screenshot({ type: "jpeg", quality: 80 });
      const base64Image = screenshot.toString("base64");
      
      await appendLog("Sending screenshot to LLM...");
      const llmResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `Ты — тестировщик. Твоя цель — кликнуть по главной статье, выполнить поиск или извлечь данные (если явно нужно). Опиши следующий шаг в формате JSON: { "action": "click" | "type" | "scroll" | "extract", "selector_description": "текст на кнопке или элементе (оставь пустым для extract/scroll)", "data": "текст для ввода или пустая строка (если extract, то верни извлеченные данные в это поле)" }. Верни ТОЛЬКО JSON без markdown.` },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
              ]
            }
          ],
          max_tokens: 500
        })
      });
      
      if (!llmResponse.ok) throw new Error(`LLM Error: ${llmResponse.statusText}`);
      const llmData = await llmResponse.json();
      const content = llmData.choices[0].message.content.replace(/```json/g, "").replace(/```/g, "").trim();
      const instruction = JSON.parse(content);
      await step("ai-explore", "decision", JSON.stringify(instruction));
      
      if (instruction.action === "click" && instruction.selector_description) {
        const loc = page.getByText(instruction.selector_description, { exact: false }).first();
        if (await loc.isVisible()) {
          await safeClick(page, loc);
          await randomPause(2000, 4000);
        } else {
          await appendLog(`Element not visible: ${instruction.selector_description}`);
        }
      } else if (instruction.action === "type" && instruction.selector_description && instruction.data) {
        const loc = page.getByText(instruction.selector_description, { exact: false }).first();
        if (await loc.isVisible()) {
          await humanType(page, loc, instruction.data);
          await page.keyboard.press("Enter");
          await randomPause(2000, 4000);
        }
      } else if (instruction.action === "scroll") {
        await page.mouse.wheel(0, 500);
        await randomPause(1000, 2000);
      } else if (instruction.action === "extract") {
        await step("ai-explore", "extract", "Extracted data: " + instruction.data);
        report.extractedData = instruction.data;
      }
      
      await step("scenario.ai-explore", "ok", "AI action completed");
    } else {
      await step("navigate", "start", `attempt=${attempt}; url=${BASE_URL}`);
      const response = await page.goto(BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });

      const status = response?.status() ?? 0;
      await step("navigate", "ok", `http=${status || "n/a"}; finalUrl=${page.url()}`);

    if ([403, 429].includes(status)) {
      if (INTERACTIVE_DEBUG) {
        await appendLog("Blocked response detected. Interactive debugging enabled, pausing script...");
        await page.pause();
      }
      throw new Error(`Blocked response (${status})`);
    }

      await randomPause(900, 1600);
      if (SCENARIO === "visit") {
        if (CLICK_SELECTOR) {
          await safeClick(page, CLICK_SELECTOR);
        }
        if (READING_DURATION_MS > 0) {
          await simulateReading(page, READING_DURATION_MS);
        }
        await step(
          "scenario.visit",
          "ok",
          CLICK_SELECTOR ? `clicked ${CLICK_SELECTOR}` : "page visit only",
        );
      } else if (SCENARIO === "search") {
        await step(
          "scenario.search",
          "start",
          SEARCH_TEXT ? "with search text" : "missing search text",
        );
        if (!SEARCH_TEXT) {
          throw new Error("SEARCH_TEXT is required for SCENARIO=search");
        }

        await ensureVisible(page, SEARCH_SELECTOR);
        await humanType(page, SEARCH_SELECTOR, SEARCH_TEXT);
        await page.keyboard.press("Enter");
        await randomPause(1400, 2600);
        if (READING_DURATION_MS > 0) {
          await simulateReading(page, READING_DURATION_MS);
        }
        await step("scenario.search", "ok", "search input submitted");
      } else if (SCENARIO === "snapshot") {
        await randomPause(700, 1200);
        if (READING_DURATION_MS > 0) {
          await simulateReading(page, READING_DURATION_MS);
        }
        await step("scenario.snapshot", "ok", "snapshot without interaction");
      } else {
        throw new Error(`Unsupported SCENARIO=${SCENARIO}`);
      }
    }

    await page.screenshot({ path: screenshotFile, fullPage: true });
    await step("screenshot", "ok", screenshotFile);

    await context.storageState({ path: path.resolve(STORAGE_STATE) });
    await step("storageState", "ok", path.resolve(STORAGE_STATE));
  } finally {
    await context.close();
  }
};

await appendLog("Starting safe automation run");
await appendLog(`Output: ${outputDir}`);
await appendLog(`Scenario: ${SCENARIO}`);
await appendLog(`Session profile: ${SESSION_PROFILE}`);

const robotsAllowed = await robotsAllowsRun();
if (!robotsAllowed) {
  await step("robots", "blocked", "disallow-all");
  report.success = false;
  await writeReport();
  process.exit(1);
}
await step("robots", "ok", "allowed or unavailable");

let success = false;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  try {
    report.attempts = attempt;
    await runAttempt(attempt);
    success = true;
    break;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    report.errors.push({
      time: now(),
      attempt,
      message,
    });
    await appendLog(`Attempt ${attempt} failed: ${message}`, "error");
    await step("attempt", "failed", `attempt=${attempt}; ${message}`);
    if (attempt < MAX_ATTEMPTS) {
      const waitMs = backoffMs(attempt);
      await appendLog(`Backoff for ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
}

if (!success) {
  await appendLog("Run failed after max attempts");
  report.success = false;
  await writeReport();
  process.exit(1);
}

await appendLog("Run completed successfully");
report.success = true;
await writeReport();
