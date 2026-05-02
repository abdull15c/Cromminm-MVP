import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const sessionProfiles = {
  desktop_en: {
    label: "Desktop EN (legacy)",
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
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
    label: "Desktop RU (legacy)",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    hasTouch: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7",
    },
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
    label: "Low-end Mobile",
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    hardwareConcurrency: 4,
    deviceMemory: 4,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
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
    label: "Mid-range Laptop",
    locale: "en-US",
    timezoneId: "America/Chicago",
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1.25,
    hasTouch: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
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
    label: "High-end Desktop",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    hasTouch: false,
    hardwareConcurrency: 16,
    deviceMemory: 16,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
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
  australia_mobile: {
    label: "Australia Mobile",
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-S901E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-AU,en;q=0.9",
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
  australia_desktop: {
    label: "Australia Desktop",
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-AU,en;q=0.9",
    },
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
};

export const getSessionProfile = (name) => {
  const profileName = name === "auto" ? "desktop_en" : name;
  const profile = sessionProfiles[profileName] ?? sessionProfiles.desktop_en;
  
  // Mod 5.4: Advanced User-Agent Rotation
  // Try to load fresh UAs from dynamic JSON if available
  const dynamicUAsPath = path.resolve('data', 'dynamic_uas.json');
  if (existsSync(dynamicUAsPath)) {
    try {
      const dynamicData = JSON.parse(readFileSync(dynamicUAsPath, 'utf8'));
      const matched = dynamicData.find(item => item.profile === name);
      if (matched) {
        if (matched.userAgent) profile.userAgent = matched.userAgent;
        if (matched.viewport) profile.viewport = matched.viewport;
      }
    } catch (err) {
      // Fallback to static if read fails
    }
  }
  
  return profile;
};
