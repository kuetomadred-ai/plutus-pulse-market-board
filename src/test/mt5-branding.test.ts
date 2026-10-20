import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const at = (path: string) => resolve(root, path);

describe("MT5 branding assets", () => {
  it("ships the icon in the UI and the installable web manifest", () => {
    const icon = "public/plotos/assets/mt5-app-icon.png";
    const manifest = JSON.parse(readFileSync(at("public/plotos/manifest.json"), "utf8"));
    const html = readFileSync(at("public/plotos/index.html"), "utf8");

    expect(existsSync(at(icon))).toBe(true);
    expect(html).toContain("assets/mt5-app-icon.png");
    expect(html).toContain("MT5-style simulator");
    for (const entry of manifest.icons) {
      expect(existsSync(at(`public/plotos/${entry.src}`))).toBe(true);
    }
  });

  it("uses PLUTUS consistently and removes white-label landing-page branding", () => {
    const html = readFileSync(at("public/plotos/index.html"), "utf8");
    const manifest = JSON.parse(readFileSync(at("public/plotos/manifest.json"), "utf8"));
    const capacitor = JSON.parse(readFileSync(at("capacitor.config.json"), "utf8"));
    const android = readFileSync(at("android/app/src/main/res/values/strings.xml"), "utf8");
    const ios = readFileSync(at("ios/App/App/Info.plist"), "utf8");

    expect(html).toContain("<title>PLUTUS</title>");
    expect(html).not.toContain("Plutus");
    expect(html).not.toContain('<footer class="lp-foot">');
    const formerBrandSuffix = ["FU", "ND"].join("");
    expect(html).not.toMatch(new RegExp(`PLUTUS\\s*<b>${formerBrandSuffix}<\\/b>`, "i"));
    expect(manifest.name).toBe("PLUTUS");
    expect(manifest.short_name).toBe("PLUTUS");
    expect(capacitor.appName).toBe("PLUTUS");
    expect(android).toContain('<string name="app_name">PLUTUS</string>');
    expect(ios).toContain("<string>PLUTUS</string>");
  });

  it("ships matching Android and iOS launcher assets", () => {
    const generator = readFileSync(at("scripts/generate-mobile-brand-assets.py"), "utf8");
    const androidXml = readFileSync(
      at("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml"),
      "utf8",
    );
    const androidSplash = readFileSync(at("android/app/src/main/res/drawable/splash.png"));
    const iosSplash = readFileSync(
      at("ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png"),
    );
    expect(androidXml).toContain("mt5_launcher_background");
    expect(generator).toContain(
      'SOURCE = ROOT / "public" / "plotos" / "assets" / "mt5-app-icon.png"',
    );
    expect(existsSync(at("public/favicon.ico"))).toBe(true);
    expect(androidSplash.toString("hex", 0, 8)).toBe("89504e470d0a1a0a");
    expect(iosSplash.toString("hex", 0, 8)).toBe("89504e470d0a1a0a");

    const iosIcon = readFileSync(
      at("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"),
    );
    expect(iosIcon.toString("hex", 0, 8)).toBe("89504e470d0a1a0a");
    expect(iosIcon.readUInt32BE(16)).toBe(1024);
    expect(iosIcon.readUInt32BE(20)).toBe(1024);
  });
});
