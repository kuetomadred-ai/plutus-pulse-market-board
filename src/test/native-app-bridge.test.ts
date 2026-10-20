// @ts-nocheck -- loosely typed test harness for untyped plain-JS app code
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  listeners: {} as Record<string, (event: { url?: string; canGoBack?: boolean }) => void>,
  native: true,
  launchUrl: null as { url: string } | null,
  minimizeApp: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (
      event: string,
      callback: (payload: { url?: string; canGoBack?: boolean }) => void,
    ) => {
      mocks.listeners[event] = callback;
    },
    getLaunchUrl: async () => mocks.launchUrl,
    minimizeApp: mocks.minimizeApp,
  },
}));

const project = path.join(process.cwd());
const androidManifest = readFileSync(
  path.join(project, "android/app/src/main/AndroidManifest.xml"),
  "utf8",
);
const androidStrings = readFileSync(
  path.join(project, "android/app/src/main/res/values/strings.xml"),
  "utf8",
);
const iosInfo = readFileSync(path.join(project, "ios/App/App/Info.plist"), "utf8");
const capacitorConfig = JSON.parse(
  readFileSync(path.join(project, "capacitor.config.json"), "utf8"),
) as { appId: string };

const appUrl = "com.plutus.trading://auth/callback?code=confirmation-code";

describe("Capacitor deep-link bridge", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.listeners = {};
    mocks.native = true;
    mocks.launchUrl = null;
    Object.assign(window, { PLUTUS_NATIVE: false, __PLUTUS_NATIVE_URL: undefined });
    await import("../../scripts/native-app-bridge.js");
  });

  it("delivers app-open URLs once to the web auth listener", () => {
    const received: string[] = [];
    window.addEventListener("plutus:native-url", (event) => {
      received.push((event as CustomEvent<string>).detail);
    });

    mocks.listeners.appUrlOpen?.({ url: appUrl });
    mocks.listeners.appUrlOpen?.({ url: appUrl });

    expect(window.PLUTUS_NATIVE).toBe(true);
    expect(window.__PLUTUS_NATIVE_URL).toBe(appUrl);
    expect(received).toEqual([appUrl]);
  });

  it("delivers the URL that launched a cold-started app", async () => {
    const received: string[] = [];
    window.addEventListener("plutus:native-url", (event) => {
      received.push((event as CustomEvent<string>).detail);
    });
    mocks.launchUrl = { url: appUrl };

    vi.resetModules();
    await import("../../scripts/native-app-bridge.js");
    await Promise.resolve();

    expect(received).toEqual([appUrl]);
  });

  it("uses the same custom URL scheme on Android, iOS, and Capacitor", () => {
    expect(androidManifest).toContain("@string/custom_url_scheme");
    expect(androidStrings).toContain('name="custom_url_scheme">com.plutus.trading</string>');
    expect(iosInfo).toContain("<string>com.plutus.trading</string>");
    expect(capacitorConfig.appId).toBe("com.plutus.trading");
  });
});
