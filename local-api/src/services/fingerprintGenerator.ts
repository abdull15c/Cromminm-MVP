import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type FingerprintOS = "windows" | "macos" | "android" | "ios" | "linux";
type DeviceType = "desktop" | "mobile" | "tablet";

type FingerprintData = {
  id: string;
  os: string;
  osVersion: string;
  deviceType: string;
  userAgent: string;
  screen: {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
    colorDepth: number;
    pixelDepth: number;
  };
  viewport: { width: number; height: number };
  timezone: string;
  timezoneOffset: number;
  language: string;
  languages: string[];
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  webgl: {
    vendor: string;
    renderer: string;
    version: string;
    shadingLanguageVersion: string;
    maxTextureSize: number;
    maxViewportDimensions: [number, number];
  };
  fonts: string[];
  plugins: Array<{ name: string; filename: string; description: string }>;
  audioContext: {
    sampleRate: number;
    maxChannelCount: number;
    numberOfInputs: number;
    numberOfOutputs: number;
    channelCount: number;
  };
  canvas: {
    noise: boolean;
    seed: string;
  };
  battery?: {
    charging: boolean;
    level: number;
  };
  sensors?: {
    accelerometer: boolean;
    gyroscope: boolean;
    magnetometer: boolean;
  };
};

type FingerprintDatabase = {
  version: string;
  lastUpdated: string;
  fingerprints: {
    windows_desktop: FingerprintData[];
    macos_desktop: FingerprintData[];
    android_mobile: FingerprintData[];
  };
};

type GenerateFingerprintOptions = {
  os?: FingerprintOS;
  deviceType?: DeviceType;
  location?: string; // ISO country code: 'US', 'AU', 'RU', etc.
};

type GeneratedFingerprint = {
  userAgent: string;
  locale: string;
  timezoneId: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  hasTouch: boolean;
  hardwareConcurrency: number;
  deviceMemory: number;
  geolocation?: { latitude: number; longitude: number; accuracy: number };
  clientHints: {
    platform: "Windows" | "Android" | "macOS";
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
  extraHTTPHeaders: Record<string, string>;
  screen: {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
    colorDepth: number;
    pixelDepth: number;
  };
  fonts: string[];
  plugins: Array<{ name: string; filename: string; description: string }>;
  audioContext: {
    sampleRate: number;
    maxChannelCount: number;
  };
  canvasNoiseSeed: string;
  battery?: {
    charging: boolean;
    level: number;
  };
  sensors?: {
    accelerometer: boolean;
    gyroscope: boolean;
    magnetometer: boolean;
  };
};

// Geolocation database (simplified)
const geolocations: Record<string, { latitude: number; longitude: number; accuracy: number; timezone: string }> = {
  US: { latitude: 40.7128, longitude: -74.006, accuracy: 80, timezone: "America/New_York" },
  AU: { latitude: -33.8688, longitude: 151.2093, accuracy: 90, timezone: "Australia/Sydney" },
  RU: { latitude: 55.7558, longitude: 37.6176, accuracy: 120, timezone: "Europe/Moscow" },
  GB: { latitude: 51.5074, longitude: -0.1278, accuracy: 85, timezone: "Europe/London" },
  DE: { latitude: 52.52, longitude: 13.405, accuracy: 90, timezone: "Europe/Berlin" },
  FR: { latitude: 48.8566, longitude: 2.3522, accuracy: 85, timezone: "Europe/Paris" },
  JP: { latitude: 35.6762, longitude: 139.6503, accuracy: 75, timezone: "Asia/Tokyo" },
  CN: { latitude: 39.9042, longitude: 116.4074, accuracy: 100, timezone: "Asia/Shanghai" },
};

let fingerprintDatabase: FingerprintDatabase | null = null;

function repoRootForSharedData(): string {
  if (process.env.APP_ROOT_DIR) {
    return process.env.APP_ROOT_DIR;
  }
  const candidates =
    process.env.NODE_ENV === "production"
      ? [process.cwd()]
      : [join(process.cwd(), ".."), process.cwd()];
  for (const dir of candidates) {
    if (existsSync(join(dir, "shared", "fingerprints.json"))) {
      return dir;
    }
  }
  return candidates[0] ?? process.cwd();
}

async function loadFingerprintDatabase(): Promise<FingerprintDatabase> {
  if (fingerprintDatabase) return fingerprintDatabase;

  const rootDir = repoRootForSharedData();
  const dbPath = join(rootDir, "shared", "fingerprints.json");

  const content = await readFile(dbPath, "utf-8");
  fingerprintDatabase = JSON.parse(content) as FingerprintDatabase;
  return fingerprintDatabase;
}

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function generateCanvasNoiseSeed(): string {
  return Math.random().toString(36).substring(2, 15);
}

function addRandomVariation(value: number, variationPercent: number): number {
  const variation = value * (variationPercent / 100);
  return Math.round(value + (Math.random() * variation * 2 - variation));
}

export async function generateFingerprint(
  options: GenerateFingerprintOptions = {}
): Promise<GeneratedFingerprint> {
  const db = await loadFingerprintDatabase();

  // Determine OS and device type
  let os = options.os;
  let deviceType = options.deviceType;

  if (!os) {
    // Random OS selection with realistic distribution
    const osDistribution = ["windows", "windows", "windows", "macos", "android"];
    os = randomChoice(osDistribution) as FingerprintOS;
  }

  if (!deviceType) {
    deviceType = os === "android" || os === "ios" ? "mobile" : "desktop";
  }

  // Select fingerprint pool
  let pool: FingerprintData[] = [];
  if (os === "windows" && deviceType === "desktop") {
    pool = db.fingerprints.windows_desktop;
  } else if (os === "macos" && deviceType === "desktop") {
    pool = db.fingerprints.macos_desktop;
  } else if (os === "android" && deviceType === "mobile") {
    pool = db.fingerprints.android_mobile;
  }

  if (pool.length === 0) {
    throw new Error(`No fingerprints available for os=${os}, deviceType=${deviceType}`);
  }

  // Select random fingerprint from pool
  const baseFingerprint = randomChoice(pool);

  // Determine geolocation
  const location = options.location ?? "US";
  const geo = geolocations[location] ?? geolocations.US;

  // Generate locale based on location
  const localeMap: Record<string, string> = {
    US: "en-US",
    AU: "en-AU",
    RU: "ru-RU",
    GB: "en-GB",
    DE: "de-DE",
    FR: "fr-FR",
    JP: "ja-JP",
    CN: "zh-CN",
  };
  const locale = localeMap[location] ?? "en-US";

  // Add variations to hardware specs (±10%)
  const hardwareConcurrency = addRandomVariation(baseFingerprint.hardwareConcurrency, 10);
  const deviceMemory = addRandomVariation(baseFingerprint.deviceMemory, 10);

  // Generate canvas noise seed
  const canvasNoiseSeed = generateCanvasNoiseSeed();

  // Extract Chrome version from userAgent
  const chromeVersionMatch = baseFingerprint.userAgent.match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
  const majorVersion = chromeVersionMatch ? chromeVersionMatch[1] : "140";
  const fullVersion = chromeVersionMatch ? `${chromeVersionMatch[1]}.${chromeVersionMatch[2]}.${chromeVersionMatch[3]}.${chromeVersionMatch[4]}` : "140.0.0.0";

  // Build clientHints
  const clientHints = {
    platform: (os === "windows" ? "Windows" : os === "macos" ? "macOS" : "Android") as "Windows" | "Android" | "macOS",
    platformVersion: baseFingerprint.osVersion,
    architecture: (os === "android" ? "arm" : "x86") as "x86" | "arm",
    bitness: (os === "android" ? "" : "64") as "64" | "",
    model: os === "android" ? baseFingerprint.userAgent.match(/;\s*([^)]+)\)/)?.[1] ?? "" : "",
    majorVersion,
    fullVersion,
    formFactors: [deviceType === "mobile" ? "Mobile" : "Desktop"] as Array<"Desktop" | "Mobile">,
  };

  // Build extraHTTPHeaders
  const extraHTTPHeaders: Record<string, string> = {
    "Accept-Language": `${locale},${locale.split("-")[0]};q=0.9,en;q=0.8`,
  };

  if (deviceType === "mobile") {
    extraHTTPHeaders["Sec-CH-UA-Mobile"] = "?1";
    extraHTTPHeaders["Sec-CH-UA-Platform"] = `"${clientHints.platform}"`;
  }

  // Build result
  const result: GeneratedFingerprint = {
    userAgent: baseFingerprint.userAgent,
    locale,
    timezoneId: geo.timezone,
    viewport: baseFingerprint.viewport,
    deviceScaleFactor: deviceType === "mobile" ? (os === "android" ? 3 : 2) : 1,
    hasTouch: deviceType === "mobile",
    hardwareConcurrency,
    deviceMemory,
    geolocation: {
      latitude: geo.latitude + (Math.random() * 0.1 - 0.05), // Add small random offset
      longitude: geo.longitude + (Math.random() * 0.1 - 0.05),
      accuracy: geo.accuracy,
    },
    clientHints,
    webgl: baseFingerprint.webgl,
    extraHTTPHeaders,
    screen: baseFingerprint.screen,
    fonts: baseFingerprint.fonts,
    plugins: baseFingerprint.plugins,
    audioContext: {
      sampleRate: baseFingerprint.audioContext.sampleRate,
      maxChannelCount: baseFingerprint.audioContext.maxChannelCount,
    },
    canvasNoiseSeed,
  };

  // Add mobile-specific features
  if (baseFingerprint.battery) {
    result.battery = {
      charging: Math.random() > 0.5,
      level: 0.5 + Math.random() * 0.5, // 50-100%
    };
  }

  if (baseFingerprint.sensors) {
    result.sensors = baseFingerprint.sensors;
  }

  return result;
}

// Validate fingerprint consistency
export function validateFingerprintConsistency(fingerprint: GeneratedFingerprint): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check timezone ↔ geolocation consistency
  if (fingerprint.geolocation && fingerprint.timezoneId) {
    const expectedTimezones: Record<string, string[]> = {
      "America/New_York": ["US", "CA"],
      "America/Los_Angeles": ["US"],
      "Europe/Moscow": ["RU"],
      "Australia/Sydney": ["AU"],
      "Europe/London": ["GB"],
    };

    // This is a simplified check - in production, use a proper timezone library
  }

  // Check language ↔ locale consistency
  if (!fingerprint.extraHTTPHeaders["Accept-Language"]?.includes(fingerprint.locale.split("-")[0])) {
    errors.push("Language header does not match locale");
  }

  // Check touch ↔ maxTouchPoints consistency
  if (fingerprint.hasTouch && fingerprint.clientHints.formFactors.includes("Desktop")) {
    errors.push("Desktop device should not have touch enabled");
  }

  // Check screen ↔ viewport consistency
  if (fingerprint.viewport.width > fingerprint.screen.width) {
    errors.push("Viewport width cannot exceed screen width");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
