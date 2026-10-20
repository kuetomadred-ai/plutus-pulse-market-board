import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const authStorage = read("scripts/native-auth-storage.js");
const mobileBuild = read("scripts/prepare-capacitor-assets.mjs");
const app = read("public/plotos/index.html");
const nativeBridge = read("scripts/native-app-bridge.js");
const capacitorConfig = JSON.parse(read("capacitor.config.json")) as {
  appId: string;
  appName: string;
};
const androidStrings = read("android/app/src/main/res/values/strings.xml");
const iosInfo = read("ios/App/App/Info.plist");
const rootRoute = read("src/routes/index.tsx");

describe("Capacitor security and auth links", () => {
  it("uses Keychain/Keystore storage for native Supabase sessions only", () => {
    expect(authStorage).toContain('SecureStorage.setKeyPrefix("plutus_auth_v1")');
    expect(authStorage).toContain("await SecureStorage.getItem(key)");
    expect(authStorage).toContain("await SecureStorage.setItem(key, legacy)");
    expect(authStorage).toContain("clearLegacyValue(key)");
    expect(app).toContain("authOptions.storage=window.PLUTUS_SECURE_AUTH_STORAGE");
    expect(app).toContain("Native secure session storage is unavailable");
  });

  it("injects secure storage before app startup and keeps native auth-link handling", () => {
    expect(mobileBuild).toContain("native-auth-storage.js");
    expect(mobileBuild).toContain("</head>");
    expect(nativeBridge).toContain('App.addListener("appUrlOpen"');
    expect(app).toContain("finishNativeAuthLink(e.detail)");
    expect(app).toContain("com.plutus.trading:");
  });

  it("uses PLUTUS branding and preserves the existing web URL", () => {
    expect(capacitorConfig).toEqual(
      expect.objectContaining({ appName: "PLUTUS", appId: "com.plutus.trading" }),
    );
    expect(app).toContain("<title>PLUTUS</title>");
    expect(androidStrings).toContain('<string name="app_name">PLUTUS</string>');
    expect(iosInfo).toMatch(/CFBundleDisplayName<\/key>\s*<string>PLUTUS<\/string>/);
    expect(rootRoute).toContain('src="/plotos/index.html"');
    expect(app).toContain("window.location.origin+'/plotos/'");
  });
});
