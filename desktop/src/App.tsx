import { useEffect, useState, type ChangeEvent } from "react";
import "./App.css";

type Profile = {
  id: string;
  name: string;
  proxy?: string;
  createdAt: string;
  running: boolean;
};

type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
};

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8787";

type ExportPayload = {
  version: number;
  exportedAt: string;
  items: Array<{
    id: string;
    name: string;
    proxy?: string;
    createdAt: string;
  }>;
};

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

type SessionProfileId =
  | "auto"
  | "desktop_en"
  | "desktop_ru"
  | "low_end_mobile"
  | "mid_range_laptop"
  | "high_end_desktop"
  | "australia_desktop"
  | "australia_mobile";

const runtimePresetDefaults: Record<
  SessionProfileId,
  {
    dpr: number;
    hasTouch: boolean;
    cores: number;
    memory: number;
    readingDurationMs: number;
    geoLat?: number;
    geoLon?: number;
    geoAccuracy?: number;
  }
> = {
  auto: {
    dpr: 1,
    hasTouch: false,
    cores: 8,
    memory: 8,
    readingDurationMs: 900,
    geoLat: -33.8688,
    geoLon: 151.2093,
    geoAccuracy: 90,
  },
  desktop_en: {
    dpr: 1,
    hasTouch: false,
    cores: 8,
    memory: 8,
    readingDurationMs: 0,
    geoLat: 40.7128,
    geoLon: -74.006,
    geoAccuracy: 80,
  },
  desktop_ru: {
    dpr: 1,
    hasTouch: false,
    cores: 8,
    memory: 8,
    readingDurationMs: 0,
    geoLat: 55.7558,
    geoLon: 37.6176,
    geoAccuracy: 120,
  },
  low_end_mobile: {
    dpr: 2,
    hasTouch: true,
    cores: 4,
    memory: 4,
    readingDurationMs: 1400,
    geoLat: 34.0522,
    geoLon: -118.2437,
    geoAccuracy: 120,
  },
  mid_range_laptop: {
    dpr: 1.25,
    hasTouch: false,
    cores: 8,
    memory: 8,
    readingDurationMs: 1200,
    geoLat: 41.8781,
    geoLon: -87.6298,
    geoAccuracy: 90,
  },
  high_end_desktop: {
    dpr: 1,
    hasTouch: false,
    cores: 16,
    memory: 16,
    readingDurationMs: 900,
    geoLat: 37.7749,
    geoLon: -122.4194,
    geoAccuracy: 60,
  },
  australia_desktop: {
    dpr: 1,
    hasTouch: false,
    cores: 8,
    memory: 8,
    readingDurationMs: 900,
    geoLat: -33.8688,
    geoLon: 151.2093,
    geoAccuracy: 90,
  },
  australia_mobile: {
    dpr: 3,
    hasTouch: true,
    cores: 8,
    memory: 8,
    readingDurationMs: 1200,
    geoLat: -33.8688,
    geoLon: 151.2093,
    geoAccuracy: 120,
  },
};

type AutomationReport = {
  runId: string;
  success: boolean;
  attempts: number;
  scenario: string;
  sessionProfile: string;
  startedAt: string;
  finishedAt: string;
  session?: {
    userDataDir?: string;
    locale?: string;
    timezoneId?: string;
    proxy?: string | null;
    deviceScaleFactor?: number;
    hasTouch?: boolean;
    hardwareConcurrency?: number;
    deviceMemory?: number;
    geolocation?: {
      latitude: number;
      longitude: number;
      accuracy: number;
    } | null;
  };
  metrics?: {
    actionCount?: number;
    typedCharacters?: number;
    totalActionMs?: number;
    hoverCount?: number;
    clickCount?: number;
    waitVisibleCount?: number;
  };
  errors?: Array<{
    time: string;
    attempt: number;
    message: string;
  }>;
  steps?: Array<{
    time: string;
    name: string;
    status: string;
    details?: string;
    durationMs?: number;
  }>;
};

function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  const edge = Math.max(4, Math.floor((max - 1) / 2));
  return `${value.slice(0, edge)}…${value.slice(-edge)}`;
}

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [proxy, setProxy] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("Ready");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "stopped">("all");
  const [automationScenario, setAutomationScenario] = useState<"visit" | "search" | "snapshot" | "warmup" | "ai-explore">(
    "visit",
  );
  const [automationHealthCheck, setAutomationHealthCheck] = useState<boolean>(false);
  const [automationBaseUrl, setAutomationBaseUrl] = useState("");
  const [automationSessionProfile, setAutomationSessionProfile] =
    useState<SessionProfileId>("auto");
  const [runtimeDpr, setRuntimeDpr] = useState<number>(runtimePresetDefaults.desktop_en.dpr);
  const [runtimeTouch, setRuntimeTouch] = useState<boolean>(
    runtimePresetDefaults.desktop_en.hasTouch,
  );
  const [runtimeCores, setRuntimeCores] = useState<number>(runtimePresetDefaults.desktop_en.cores);
  const [runtimeMemory, setRuntimeMemory] = useState<number>(runtimePresetDefaults.desktop_en.memory);
  const [runtimeReadingMs, setRuntimeReadingMs] = useState<number>(
    runtimePresetDefaults.desktop_en.readingDurationMs,
  );
  const [runtimeGeoLat, setRuntimeGeoLat] = useState<string>(
    String(runtimePresetDefaults.desktop_en.geoLat ?? ""),
  );
  const [runtimeGeoLon, setRuntimeGeoLon] = useState<string>(
    String(runtimePresetDefaults.desktop_en.geoLon ?? ""),
  );
  const [runtimeGeoAccuracy, setRuntimeGeoAccuracy] = useState<string>(
    String(runtimePresetDefaults.desktop_en.geoAccuracy ?? 100),
  );
  const [automationRuns, setAutomationRuns] = useState<AutomationStatus[]>([]);
  const [automationReport, setAutomationReport] = useState<AutomationReport | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [activeNav, setActiveNav] = useState<"profiles" | "automation" | "cookies" | "settings">("profiles");
  const [manualSessionProfile, setManualSessionProfile] = useState<SessionProfileId>("auto");
  const [showFingerprintGenerator, setShowFingerprintGenerator] = useState(false);
  const [fingerprintOptions, setFingerprintOptions] = useState({
    os: "windows",
    deviceType: "desktop",
    location: "US",
  });
  const [selectedProfileForCookies, setSelectedProfileForCookies] = useState<string | null>(null);
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [cookieImportContent, setCookieImportContent] = useState("");
  const [cookieImportFormat, setCookieImportFormat] = useState<"json" | "netscape">("json");

  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [editName, setEditName] = useState("");
  const [editProxy, setEditProxy] = useState("");

  const loadProfiles = async () => {
    const response = await fetch(`${API}/profiles`);
    const data = (await response.json()) as { items: Profile[] };
    setProfiles(data.items);
  };

  useEffect(() => {
    loadProfiles().catch(() => {
      setMessage("Cannot connect to local API. Start local-api first.");
    });
  }, []);

  const loadAutomationStatus = async () => {
    const response = await fetch(`${API}/automation/status`);
    const data = (await response.json()) as { runs: AutomationStatus[] };
    setAutomationRuns(data.runs);
  };

  const loadAutomationReport = async () => {
    const response = await fetch(`${API}/automation/report/latest`);
    const data = (await response.json()) as {
      exists: boolean;
      report?: AutomationReport;
    };
    setAutomationReport(data.exists ? (data.report ?? null) : null);
  };

  useEffect(() => {
    Promise.all([loadAutomationStatus(), loadAutomationReport()]).catch(() => {
      setMessage("Cannot load automation status");
    });

    const timer = window.setInterval(() => {
      Promise.all([loadAutomationStatus(), loadAutomationReport()]).catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (message && message !== "Ready" && !message.startsWith("Creating") && !message.startsWith("Updating")) {
      const timer = setTimeout(() => setMessage("Ready"), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const createProfile = async () => {
    if (!name.trim()) return;
    setBusyId("new");
    setMessage("Creating profile...");
    try {
      const response = await fetch(`${API}/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          proxy: proxy.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to create profile");
      }

      setName("");
      setProxy("");
      setMessage("Profile created");
      await loadProfiles();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const deleteProfile = async (profile: Profile) => {
    setBusyId(profile.id);
    setMessage(`Deleting ${profile.name}...`);
    try {
      const response = await fetch(`${API}/profiles/${profile.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Delete failed");
      }
      setMessage(`${profile.name} deleted`);
      await loadProfiles();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const editProfile = (profile: Profile) => {
    setEditingProfile(profile);
    setEditName(profile.name);
    setEditProxy(profile.proxy ?? "");
  };

  const saveEditProfile = async () => {
    if (!editingProfile) return;
    setBusyId(editingProfile.id);
    setMessage(`Updating ${editingProfile.name}...`);
    try {
      const response = await fetch(`${API}/profiles/${editingProfile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          proxy: editProxy.trim() || undefined,
        }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Update failed");
      }

      setMessage(`${editingProfile.name} updated`);
      await loadProfiles();
      setEditingProfile(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const checkProxy = async () => {
    if (!proxy.trim()) {
      setMessage("Enter proxy first");
      return;
    }

    setBusyId("proxy-check");
    setMessage("Checking proxy...");
    try {
      const response = await fetch(`${API}/proxy/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy: proxy.trim() }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        latencyMs?: number;
        message?: string;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? data.message ?? "Proxy check failed");
      }

      setMessage(
        `Proxy reachable${typeof data.latencyMs === "number" ? ` (${data.latencyMs}ms)` : ""}`,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const exportProfiles = async () => {
    setBusyId("export");
    setMessage("Exporting profiles...");
    try {
      const response = await fetch(`${API}/profiles/export`);
      if (!response.ok) {
        throw new Error("Failed to export profiles");
      }

      const data = (await response.json()) as ExportPayload;
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `profiles-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(`Exported ${data.items.length} profile(s)`);
    } catch {
      setMessage("Error while exporting");
    } finally {
      setBusyId(null);
    }
  };

  const importProfiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    // Security: Check file size (max 10MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      setMessage(`Error: File too large (max 10MB, got ${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      return;
    }

    setBusyId("import");
    setMessage("Importing profiles...");
    try {
      const content = await file.text();
      const parsed = JSON.parse(content) as {
        items?: Array<{ name?: string; proxy?: string }>;
      };

      const response = await fetch(`${API}/profiles/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "merge",
          items: parsed.items ?? [],
        }),
      });

      const data = (await response.json()) as { imported?: number; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Import failed");
      }

      setMessage(`Imported ${data.imported ?? 0} profile(s)`);
      await loadProfiles();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Import error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const actionProfile = async (profile: Profile, action: "start" | "stop") => {
    setBusyId(profile.id);
    setMessage(`${action === "start" ? "Starting" : "Stopping"} ${profile.name}...`);
    try {
      const response = await fetch(`${API}/profiles/${profile.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "start" ? JSON.stringify({ sessionProfile: manualSessionProfile }) : undefined,
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Action failed");
      }

      setMessage(`${profile.name}: ${action} success`);
      await loadProfiles();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const runAutomation = async () => {
    setBusyId("automation");
    setMessage(`Starting automation (${automationScenario})...`);
    try {
      const response = await fetch(`${API}/automation/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: automationScenario,
          sessionProfile: automationSessionProfile,
          healthCheck: automationHealthCheck,
          baseUrl: automationBaseUrl.trim() || undefined,
          runtimeOverrides: {
            deviceScaleFactor: runtimeDpr,
            hasTouch: runtimeTouch,
            hardwareConcurrency: runtimeCores,
            deviceMemory: runtimeMemory,
            readingDurationMs: runtimeReadingMs,
            geoLat: runtimeGeoLat.trim() ? Number(runtimeGeoLat) : undefined,
            geoLon: runtimeGeoLon.trim() ? Number(runtimeGeoLon) : undefined,
            geoAccuracy: runtimeGeoAccuracy.trim() ? Number(runtimeGeoAccuracy) : undefined,
          },
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Cannot start automation");
      }
      setMessage(`Automation started: ${automationScenario} (${automationSessionProfile})`);
      await Promise.all([loadAutomationStatus(), loadAutomationReport()]);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const stopAutomation = async (pid: number) => {
    try {
      const response = await fetch(`${API}/automation/${pid}/stop`, { method: "POST" });
      if (!response.ok) throw new Error("Stop failed");
      await loadAutomationStatus();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    }
  };

  const applyRuntimePreset = (presetId: SessionProfileId) => {
    const preset = runtimePresetDefaults[presetId];
    setRuntimeDpr(preset.dpr);
    setRuntimeTouch(preset.hasTouch);
    setRuntimeCores(preset.cores);
    setRuntimeMemory(preset.memory);
    setRuntimeReadingMs(preset.readingDurationMs);
    setRuntimeGeoLat(String(preset.geoLat ?? ""));
    setRuntimeGeoLon(String(preset.geoLon ?? ""));
    setRuntimeGeoAccuracy(String(preset.geoAccuracy ?? 100));
  };

  const resetOverridesToPreset = () => {
    applyRuntimePreset(automationSessionProfile);
    setMessage(`Overrides reset to preset: ${automationSessionProfile}`);
  };

  const openLatestReportFolder = async () => {
    setBusyId("open-report");
    try {
      const response = await fetch(`${API}/automation/report/latest/open`, {
        method: "POST",
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Cannot open report folder");
      }
      setMessage("Opened latest report folder");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const generateFingerprint = async () => {
    setBusyId("generate-fingerprint");
    setMessage("Generating fingerprint...");
    try {
      const response = await fetch(`${API}/profiles/generate-fingerprint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fingerprintOptions),
      });
      
      const data = (await response.json()) as { 
        ok?: boolean; 
        error?: string;
        fingerprint?: any;
        validation?: { valid: boolean; errors: string[] };
      };
      
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to generate fingerprint");
      }
      
      if (data.validation && !data.validation.valid) {
        setMessage(`Warning: ${data.validation.errors.join(", ")}`);
      } else {
        setMessage("Fingerprint generated successfully");
      }
      
      console.log("Generated fingerprint:", data.fingerprint);
      
      setShowFingerprintGenerator(false);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const loadCookies = async (profileId: string) => {
    try {
      const response = await fetch(`${API}/profiles/${profileId}/cookies`);
      const data = (await response.json()) as { cookies: Cookie[] };
      setCookies(data.cookies || []);
    } catch (error) {
      setMessage("Failed to load cookies");
      setCookies([]);
    }
  };

  const exportCookies = async (profileId: string, format: "json" | "netscape") => {
    setBusyId("export-cookies");
    try {
      const response = await fetch(`${API}/profiles/${profileId}/cookies/export?format=${format}`);
      const data = (await response.json()) as { format: string; content: string; count: number };
      
      const blob = new Blob([data.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cookies-${profileId}-${Date.now()}.${format === "json" ? "json" : "txt"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      
      setMessage(`Exported ${data.count} cookies`);
    } catch (error) {
      setMessage("Failed to export cookies");
    } finally {
      setBusyId(null);
    }
  };

  const importCookies = async (profileId: string) => {
    if (!cookieImportContent.trim()) {
      setMessage("Enter cookie content first");
      return;
    }
    
    setBusyId("import-cookies");
    try {
      const response = await fetch(`${API}/profiles/${profileId}/cookies/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: cookieImportContent,
          format: cookieImportFormat,
          overwrite: false,
        }),
      });
      
      const data = (await response.json()) as { ok?: boolean; error?: string; imported?: number; total?: number };
      
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to import cookies");
      }
      
      setMessage(`Imported ${data.imported} cookies (total: ${data.total})`);
      setCookieImportContent("");
      await loadCookies(profileId);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const deleteCookie = async (profileId: string, cookie: Cookie) => {
    setBusyId("delete-cookie");
    try {
      const params = new URLSearchParams({ domain: cookie.domain });
      if (cookie.path) {
        params.set("path", cookie.path);
      }
      const response = await fetch(
        `${API}/profiles/${profileId}/cookies/${encodeURIComponent(cookie.name)}?${params.toString()}`,
        { method: "DELETE" },
      );
      
      const data = (await response.json()) as { ok?: boolean; error?: string };
      
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to delete cookie");
      }
      
      setMessage("Cookie deleted");
      await loadCookies(profileId);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Error: ${text}`);
    } finally {
      setBusyId(null);
    }
  };

  const filteredProfiles = profiles.filter((profile) => {
    const normalizedQuery = query.trim().toLowerCase();
    const byQuery =
      normalizedQuery.length === 0 ||
      profile.name.toLowerCase().includes(normalizedQuery) ||
      profile.id.toLowerCase().includes(normalizedQuery) ||
      (profile.proxy ?? "").toLowerCase().includes(normalizedQuery);

    const byStatus =
      statusFilter === "all" ||
      (statusFilter === "running" && profile.running) ||
      (statusFilter === "stopped" && !profile.running);

    return byQuery && byStatus;
  });

  const runningProfiles = profiles.filter((profile) => profile.running).length;
  const stoppedProfiles = profiles.length - runningProfiles;
  const activeAutomationRuns = automationRuns.filter((run) => run.running).length;

  return (
    <div className={`adspower-layout app-shell ${theme}`}>
      <aside className="ap-sidebar">
        <div className="ap-brand">
          <div className="ap-brand-mark">Cr</div>
          <div className="ap-brand-text">
            <strong>Cromminm</strong>
            <small>Browser profiles</small>
          </div>
        </div>
        <nav className="ap-nav">
          <button
            type="button"
            className={activeNav === "profiles" ? "active" : ""}
            onClick={() => setActiveNav("profiles")}
          >
            <span className="ap-nav-icon">▣</span>
            Profiles
          </button>
          <button
            type="button"
            className={activeNav === "automation" ? "active" : ""}
            onClick={() => setActiveNav("automation")}
          >
            <span className="ap-nav-icon">▸</span>
            Automation
          </button>
          <button
            type="button"
            className={activeNav === "cookies" ? "active" : ""}
            onClick={() => setActiveNav("cookies")}
          >
            <span className="ap-nav-icon">◔</span>
            Cookies
          </button>
          <button
            type="button"
            className={activeNav === "settings" ? "active" : ""}
            onClick={() => setActiveNav("settings")}
          >
            <span className="ap-nav-icon">⚙</span>
            Tools
          </button>
        </nav>
        <div className="ap-sidebar-footer">
          <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            <span className="ap-nav-icon">☼</span>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </div>
      </aside>

      <div className="ap-main">
        <header className="ap-topbar">
          {activeNav === "profiles" && (
            <>
              <h1 className="ap-topbar-title">Profiles</h1>
              <div className="ap-search-wrap">
                <input
                  placeholder="Search name, ID or proxy…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search profiles"
                />
              </div>
              <select
                className="ap-toolbar-select"
                title="Status filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "all" | "running" | "stopped")}
              >
                <option value="all">All statuses</option>
                <option value="running">Running</option>
                <option value="stopped">Stopped</option>
              </select>
              <select
                className="ap-toolbar-select"
                title="Fingerprint preset when starting browser"
                value={manualSessionProfile}
                onChange={(event) => setManualSessionProfile(event.target.value as SessionProfileId)}
              >
                <option value="auto">Preset: Auto</option>
                <option value="australia_desktop">Australia Desktop</option>
                <option value="australia_mobile">Australia Mobile</option>
                <option value="desktop_en">Desktop EN</option>
                <option value="desktop_ru">Desktop RU</option>
                <option value="low_end_mobile">Low-end Mobile</option>
                <option value="mid_range_laptop">Mid-range Laptop</option>
                <option value="high_end_desktop">High-end Desktop</option>
              </select>
              <div className="ap-topbar-actions">
                <button type="button" className="ap-btn ap-btn-primary" onClick={() => void loadProfiles()}>
                  Sync
                </button>
                <label className="ap-btn ap-upload">
                  Import
                  <input type="file" accept=".json" className="ap-sr-only" onChange={importProfiles} />
                </label>
                <button
                  type="button"
                  className="ap-btn"
                  onClick={exportProfiles}
                  disabled={busyId === "export"}
                >
                  Export all
                </button>
              </div>
            </>
          )}
          {activeNav === "automation" && <h1 className="ap-topbar-title">Automation</h1>}
          {activeNav === "cookies" && <h1 className="ap-topbar-title">Cookies</h1>}
          {activeNav === "settings" && <h1 className="ap-topbar-title">Tools</h1>}
        </header>

        <div className="ap-content">
          {activeNav === "profiles" && (
            <>
              <div className="ap-stats-row">
                <div className="ap-stat-tile">
                  <span>Total</span>
                  <strong>{profiles.length}</strong>
                </div>
                <div className="ap-stat-tile">
                  <span>Running</span>
                  <strong>{runningProfiles}</strong>
                </div>
                <div className="ap-stat-tile">
                  <span>Stopped</span>
                  <strong>{stoppedProfiles}</strong>
                </div>
                <div className="ap-stat-tile">
                  <span>Automation runs</span>
                  <strong>{activeAutomationRuns}</strong>
                </div>
              </div>

              <details className="ap-panel" open>
                <summary className="ap-panel-header">
                  <span>New profile</span>
                  <small>Optional proxy · check before save</small>
                </summary>
                <div className="ap-panel-body">
                  <div className="ap-fields">
                    <input
                      placeholder="Profile name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <input
                      placeholder="Proxy — socks5://host:port"
                      value={proxy}
                      onChange={(event) => setProxy(event.target.value)}
                    />
                    <button
                      type="button"
                      className="ap-btn"
                      onClick={checkProxy}
                      disabled={busyId === "proxy-check"}
                    >
                      {busyId === "proxy-check" ? "Checking…" : "Check"}
                    </button>
                    <button
                      type="button"
                      className="ap-btn ap-btn-primary"
                      onClick={createProfile}
                      disabled={busyId === "new"}
                    >
                      {busyId === "new" ? "Creating…" : "Create"}
                    </button>
                  </div>
                  <p className="desc" style={{ margin: "0.75rem 0 0", fontSize: "0.8rem", color: "var(--ap-text-muted)" }}>
                    Fingerprint preview tool: sidebar → Tools.
                  </p>
                </div>
              </details>

              {profiles.length === 0 ? (
                <div className="ap-empty-state">
                  <div className="ap-empty-icon">👥</div>
                  <h3>No Profiles Found</h3>
                  <p>You don't have any browser profiles yet. Create your first one to get started.</p>
                </div>
              ) : filteredProfiles.length === 0 ? (
                <div className="ap-empty-state">
                  <div className="ap-empty-icon">🔍</div>
                  <h3>No matches</h3>
                  <p>No profiles match your current search or status filter.</p>
                </div>
              ) : (
                <div className="ap-table-container">
                  <table className="ap-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Profile Name</th>
                        <th>ID & Created</th>
                        <th>Proxy</th>
                        <th className="ap-text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProfiles.map((profile) => (
                        <tr key={profile.id}>
                          <td>
                            <div className="ap-status-cell">
                              <span className={`ap-status-dot ${profile.running ? "on" : ""}`} title={profile.running ? "Running" : "Stopped"} />
                              {profile.running ? "Running" : "Stopped"}
                            </div>
                          </td>
                          <td className="ap-font-medium">{profile.name}</td>
                          <td>
                            <div className="ap-text-sm" title={profile.id}>{truncateMiddle(profile.id, 12)}</div>
                            <div className="ap-text-xs ap-text-muted">{new Date(profile.createdAt).toLocaleString()}</div>
                          </td>
                          <td>
                            {profile.proxy ? (
                              <span className="ap-badge" title={profile.proxy}>{truncateMiddle(profile.proxy, 20)}</span>
                            ) : (
                              <span className="ap-text-muted">Direct</span>
                            )}
                          </td>
                          <td className="ap-actions-cell">
                            <button
                              type="button"
                              className={`ap-btn-icon ${profile.running ? "danger" : "success"}`}
                              onClick={() => void actionProfile(profile, profile.running ? "stop" : "start")}
                              disabled={busyId === profile.id}
                              title={profile.running ? "Stop Profile" : "Start Profile"}
                            >
                              {profile.running ? "⏹" : "▶"}
                            </button>
                            <button
                              type="button"
                              className="ap-btn-icon"
                              onClick={() => editProfile(profile)}
                              disabled={busyId === profile.id}
                              title="Edit Profile"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="ap-btn-icon danger"
                              onClick={() => void deleteProfile(profile)}
                              disabled={busyId === profile.id}
                              title="Delete Profile"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeNav === "cookies" && (
            <div className="ap-section">
              <h2>Cookie storage</h2>
              <p className="desc">Per-profile JSON cache — import Netscape or JSON exports.</p>

              <div className="ap-fields" style={{ marginBottom: "1rem" }}>
                <select
                  className="ap-toolbar-select"
                  value={selectedProfileForCookies ?? ""}
                  onChange={(event) => {
                    const id = event.target.value || null;
                    setSelectedProfileForCookies(id);
                    if (id) void loadCookies(id);
                    else setCookies([]);
                  }}
                >
                  <option value="">Select profile</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ap-btn"
                  disabled={!selectedProfileForCookies}
                  onClick={() =>
                    selectedProfileForCookies ? void loadCookies(selectedProfileForCookies) : undefined
                  }
                >
                  Refresh
                </button>
              </div>

              {!selectedProfileForCookies ? (
                <div className="ap-empty-state" style={{ padding: '2rem' }}>
                  <div className="ap-empty-icon">🍪</div>
                  <p>Select a profile to list cookies.</p>
                </div>
              ) : cookies.length === 0 ? (
                <div className="ap-empty-state" style={{ padding: '2rem' }}>
                  <div className="ap-empty-icon">📭</div>
                  <p>No cookies stored for this profile.</p>
                </div>
              ) : (
                <ul className="ap-list-plain">
                  {cookies.map((c, idx) => (
                    <li key={`${c.name}-${c.domain}-${idx}`}>
                      <div>
                        <strong>{c.name}</strong>
                        <span style={{ color: "var(--ap-text-muted)", marginLeft: "0.5rem", fontSize: "0.85rem" }}>
                          {c.domain} · {c.path}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="ap-btn ap-btn-danger"
                        disabled={busyId === "delete-cookie"}
                        onClick={() =>
                          selectedProfileForCookies
                            ? void deleteCookie(selectedProfileForCookies, c)
                            : undefined
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="ap-fields" style={{ marginTop: "1rem", flexDirection: "column", alignItems: "stretch" }}>
                <textarea
                  placeholder="Paste Netscape or JSON cookie export…"
                  value={cookieImportContent}
                  onChange={(e) => setCookieImportContent(e.target.value)}
                  rows={4}
                  style={{ width: "100%", minWidth: 0 }}
                />
                <div className="ap-fields">
                  <select
                    className="ap-toolbar-select"
                    value={cookieImportFormat}
                    onChange={(e) => setCookieImportFormat(e.target.value as "json" | "netscape")}
                  >
                    <option value="json">JSON</option>
                    <option value="netscape">Netscape</option>
                  </select>
                  <button
                    type="button"
                    className="ap-btn ap-btn-primary"
                    disabled={!selectedProfileForCookies || busyId === "import-cookies"}
                    onClick={() =>
                      selectedProfileForCookies ? void importCookies(selectedProfileForCookies) : undefined
                    }
                  >
                    {busyId === "import-cookies" ? "Importing…" : "Import"}
                  </button>
                  <button
                    type="button"
                    className="ap-btn"
                    disabled={!selectedProfileForCookies || busyId === "export-cookies"}
                    onClick={() =>
                      selectedProfileForCookies ? void exportCookies(selectedProfileForCookies, "json") : undefined
                    }
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    className="ap-btn"
                    disabled={!selectedProfileForCookies || busyId === "export-cookies"}
                    onClick={() =>
                      selectedProfileForCookies
                        ? void exportCookies(selectedProfileForCookies, "netscape")
                        : undefined
                    }
                  >
                    Netscape
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeNav === "automation" && (
            <div className="ap-section">
              <h2>Automation</h2>
              <p className="desc">Playwright scenarios · poll status every 4s in background.</p>

      <details className="ap-panel" open>
        <summary className="ap-panel-header">
          <span>Run</span>
          <small>{automationRuns.length} runs in memory</small>
        </summary>
        <div className="ap-panel-body">
        <div className="ap-fields" style={{ flexWrap: "wrap" }}>
          <input
            type="url"
            placeholder="Target URL (optional, default example.com)"
            value={automationBaseUrl}
            onChange={(e) => setAutomationBaseUrl(e.target.value)}
            style={{ minWidth: "min(100%, 22rem)" }}
          />
          <select
            className="ap-toolbar-select"
            value={automationScenario}
            onChange={(event) =>
              setAutomationScenario(event.target.value as "visit" | "search" | "snapshot" | "warmup" | "ai-explore")
            }
          >
            <option value="visit">Visit</option>
            <option value="search">Search</option>
            <option value="snapshot">Snapshot</option>
            <option value="warmup">Warmup</option>
            <option value="ai-explore">AI explore</option>
          </select>
          <select
            className="ap-toolbar-select"
            value={automationSessionProfile}
            onChange={(event) => {
              const selected = event.target.value as SessionProfileId;
              setAutomationSessionProfile(selected);
              applyRuntimePreset(selected);
            }}
          >
            <option value="auto">Auto</option>
            <option value="desktop_en">Desktop EN</option>
            <option value="desktop_ru">Desktop RU</option>
            <option value="low_end_mobile">Low-end Mobile</option>
            <option value="mid_range_laptop">Mid-range Laptop</option>
            <option value="high_end_desktop">High-end Desktop</option>
            <option value="australia_desktop">Australia Desktop</option>
            <option value="australia_mobile">Australia Mobile</option>
          </select>
          <button
            type="button"
            className="ap-btn ap-btn-primary"
            onClick={runAutomation}
            disabled={busyId === "automation"}
          >
            Run
          </button>
          <button
            type="button"
            className="ap-btn"
            onClick={() => void Promise.all([loadAutomationStatus(), loadAutomationReport()])}
          >
            Refresh
          </button>
          <button type="button" className="ap-btn" onClick={() => applyRuntimePreset(automationSessionProfile)}>
            Apply preset
          </button>
          <button type="button" className="ap-btn" onClick={resetOverridesToPreset}>
            Reset
          </button>
        </div>

        <div className="ap-runtime-groups">
          <fieldset className="ap-runtime-group">
            <legend>Hardware Options</legend>
            <div className="ap-runtime-grid">
              <label>Cores<input type="number" value={runtimeCores} onChange={(event) => setRuntimeCores(Number(event.target.value || 1))} /></label>
              <label>Memory<input type="number" value={runtimeMemory} onChange={(event) => setRuntimeMemory(Number(event.target.value || 1))} /></label>
              <label>DPR<input type="number" step="0.1" value={runtimeDpr} onChange={(event) => setRuntimeDpr(Number(event.target.value || 1))} /></label>
              <label className="ap-switch-row" style={{ marginTop: '0.5rem' }}>
                <input type="checkbox" checked={runtimeTouch} onChange={(event) => setRuntimeTouch(event.target.checked)} />
                Has Touch
              </label>
            </div>
          </fieldset>

          <fieldset className="ap-runtime-group">
            <legend>Geolocation</legend>
            <div className="ap-runtime-grid">
              <label>Latitude<input type="number" step="0.0001" value={runtimeGeoLat} onChange={(event) => setRuntimeGeoLat(event.target.value)} /></label>
              <label>Longitude<input type="number" step="0.0001" value={runtimeGeoLon} onChange={(event) => setRuntimeGeoLon(event.target.value)} /></label>
              <label>Accuracy<input type="number" value={runtimeGeoAccuracy} onChange={(event) => setRuntimeGeoAccuracy(event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset className="ap-runtime-group">
            <legend>Behavior</legend>
            <div className="ap-runtime-grid">
              <label>Reading (ms)<input type="number" value={runtimeReadingMs} onChange={(event) => setRuntimeReadingMs(Number(event.target.value || 0))} /></label>
              <label className="ap-switch-row" style={{ marginTop: '0.5rem' }}>
                <input type="checkbox" checked={automationHealthCheck} onChange={(event) => setAutomationHealthCheck(event.target.checked)} />
                Run Healthcheck
              </label>
            </div>
          </fieldset>
        </div>

        {automationRuns.length === 0 ? (
          <div className="ap-empty-state" style={{ padding: '2rem' }}>
            <div className="ap-empty-icon">⏳</div>
            <p>No runs yet — start a scenario above.</p>
          </div>
        ) : (
          <div className="ap-run-list" style={{ marginTop: "0.75rem" }}>
            {automationRuns.map((run) => (
              <article key={run.id} className="ap-run-card">
                <div className="ap-run-head">
                  <strong>{run.scenario}</strong>
                  <span style={{ color: "var(--ap-text-muted)", fontSize: "0.85rem" }}>
                    {run.running ? "running" : `stopped (${run.exitCode})`}
                  </span>
                  {run.running && run.pid ? (
                    <button type="button" className="ap-btn ap-btn-danger" onClick={() => stopAutomation(run.pid!)}>
                      Stop
                    </button>
                  ) : null}
                </div>
                <small style={{ color: "var(--ap-text-muted)" }}>
                  {run.sessionProfile} · PID {run.pid ?? "-"} · {run.proxy ?? "no proxy"}
                </small>
                <div className="ap-logs terminal-logs">
                  {run.logs.length === 0 ? (
                    <div className="ap-text-muted">No logs yet...</div>
                  ) : (
                    run.logs.map((line, idx) => (
                      <div key={idx} className={`log-line ${line.toLowerCase().includes("error") || line.toLowerCase().includes("failed") ? "error" : ""}`}>
                        {line}
                      </div>
                    ))
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        </div>
      </details>

      <details className="ap-panel" open style={{ marginTop: "0.75rem" }}>
        <summary className="ap-panel-header">
          <span>Latest report</span>
          <small>{automationReport ? automationReport.runId : "No report"}</small>
        </summary>
        <div className="ap-panel-body">
        <button
          type="button"
          className="ap-btn"
          onClick={openLatestReportFolder}
          disabled={busyId === "open-report" || !automationReport}
        >
          Open report folder
        </button>
        {automationReport ? (
          <div style={{ marginTop: "0.75rem" }}>
            <div className="ap-report-metrics">
              <div><span>Result</span><strong>{automationReport.success ? "success" : "failed"}</strong></div>
              <div><span>Attempts</span><strong>{automationReport.attempts}</strong></div>
              <div><span>Actions</span><strong>{automationReport.metrics?.actionCount ?? 0}</strong></div>
              <div><span>Clicks</span><strong>{automationReport.metrics?.clickCount ?? 0}</strong></div>
              <div><span>Typed</span><strong>{automationReport.metrics?.typedCharacters ?? 0}</strong></div>
              <div><span>Visible</span><strong>{automationReport.metrics?.waitVisibleCount ?? 0}</strong></div>
            </div>
            <p style={{ fontSize: "0.9rem", color: "var(--ap-text-muted)" }}>
              Session: {automationReport.session?.locale ?? "-"} / {automationReport.session?.timezoneId ?? "-"}
            </p>
            {automationReport.errors && automationReport.errors.length > 0 ? (
              <div className="ap-errors-box">
                <strong>Errors</strong>
                {automationReport.errors.slice(-3).map((item) => (
                  <p key={`${item.time}-${item.attempt}`}>[{item.attempt}] {item.message}</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="ap-empty-state" style={{ padding: '2rem' }}>
            <div className="ap-empty-icon">📊</div>
            <p>No report file yet — run automation with output enabled.</p>
          </div>
        )}
        </div>
      </details>
            </div>
          )}

          {activeNav === "settings" && (
            <div className="ap-section">
              <h2>Tools</h2>
              <p className="desc">Fingerprint preview (console) · merge JSON profiles.</p>
              <div className="ap-fields" style={{ marginBottom: "1rem" }}>
                <label className="ap-btn ap-upload">
                  Import profiles (.json)
                  <input type="file" accept=".json" className="ap-sr-only" onChange={importProfiles} />
                </label>
                <button type="button" className="ap-btn" onClick={exportProfiles} disabled={busyId === "export"}>
                  Export all profiles
                </button>
                <button type="button" className="ap-btn ap-btn-primary" onClick={() => void loadProfiles()}>
                  Sync list
                </button>
              </div>
              <button
                type="button"
                className="ap-btn"
                onClick={() => setShowFingerprintGenerator(!showFingerprintGenerator)}
              >
                {showFingerprintGenerator ? "Hide fingerprint tool" : "Fingerprint generator"}
              </button>
              {showFingerprintGenerator ? (
                <div className="fingerprint-generator">
                  <h3>Fingerprint generator</h3>
                  <div className="ap-fields">
                    <select
                      value={fingerprintOptions.os}
                      onChange={(e) => setFingerprintOptions({ ...fingerprintOptions, os: e.target.value })}
                    >
                      <option value="windows">Windows</option>
                      <option value="macos">macOS</option>
                      <option value="android">Android</option>
                    </select>
                    <select
                      value={fingerprintOptions.deviceType}
                      onChange={(e) => setFingerprintOptions({ ...fingerprintOptions, deviceType: e.target.value })}
                    >
                      <option value="desktop">Desktop</option>
                      <option value="mobile">Mobile</option>
                    </select>
                    <select
                      value={fingerprintOptions.location}
                      onChange={(e) => setFingerprintOptions({ ...fingerprintOptions, location: e.target.value })}
                    >
                      <option value="US">United States</option>
                      <option value="AU">Australia</option>
                      <option value="RU">Russia</option>
                      <option value="GB">United Kingdom</option>
                      <option value="DE">Germany</option>
                      <option value="FR">France</option>
                      <option value="JP">Japan</option>
                      <option value="CN">China</option>
                    </select>
                    <button
                      type="button"
                      className="ap-btn ap-btn-primary"
                      onClick={generateFingerprint}
                      disabled={busyId === "generate-fingerprint"}
                    >
                      {busyId === "generate-fingerprint" ? "Generating…" : "Generate"}
                    </button>
                  </div>
                  <small>Output is logged to DevTools (F12).</small>
                </div>
              ) : null}
            </div>
          )}

        </div>

        <div className="ap-toast-container">
          {message !== "Ready" && <div className="ap-toast">{message}</div>}
        </div>

        {editingProfile && (
          <div className="ap-modal-backdrop">
            <div className="ap-modal">
              <h3>Edit Profile</h3>
              <div className="ap-form-group">
                <label>Profile Name</label>
                <input
                  className="ap-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="E.g. My Custom Profile"
                />
              </div>
              <div className="ap-form-group">
                <label>Proxy Settings (Optional)</label>
                <input
                  className="ap-input"
                  value={editProxy}
                  onChange={(e) => setEditProxy(e.target.value)}
                  placeholder="http://user:pass@host:port"
                />
                <small className="ap-text-muted">Leave empty to unset.</small>
              </div>
              <div className="ap-modal-actions">
                <button type="button" className="ap-btn" onClick={() => setEditingProfile(null)}>
                  Cancel
                </button>
                <button type="button" className="ap-btn ap-btn-primary" onClick={saveEditProfile} disabled={busyId === editingProfile.id}>
                  {busyId === editingProfile.id ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
