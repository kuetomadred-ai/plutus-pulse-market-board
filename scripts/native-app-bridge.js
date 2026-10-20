import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

if (Capacitor.isNativePlatform()) {
  window.PLUTUS_NATIVE = true;

  App.addListener("backButton", ({ canGoBack }) => {
    const sheet = document.getElementById("mt5ModifySheet");
    const sheetClose = document.getElementById("mt5SheetClose");
    if (sheet && sheetClose) {
      sheetClose.click();
      return;
    }
    const modal = document.getElementById("ovl");
    if (modal?.classList.contains("on")) {
      modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return;
    }
    const drawer = document.getElementById("drawer");
    const drawerOverlay = document.getElementById("dOvl");
    if (drawer?.classList.contains("on") && drawerOverlay) {
      drawerOverlay.click();
      return;
    }
    if (canGoBack) window.history.back();
    else App.minimizeApp();
  });

  const deliveredUrls = new Set();
  const deliverUrl = (url) => {
    if (!url || deliveredUrls.has(url)) return;
    deliveredUrls.add(url);
    window.__PLUTUS_NATIVE_URL = url;
    window.dispatchEvent(new CustomEvent("plutus:native-url", { detail: url }));
  };

  App.addListener("appUrlOpen", ({ url }) => deliverUrl(url));
  App.getLaunchUrl()
    .then((launch) => deliverUrl(launch?.url))
    .catch(() => {});
} else {
  window.PLUTUS_NATIVE = false;
}
