import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

window.PLUTUS_NATIVE = Capacitor.isNativePlatform();
if (window.PLUTUS_NATIVE) {
  const ready = SecureStorage.setKeyPrefix("plutus_auth_v1");
  const legacyValue = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const clearLegacyValue = (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Best-effort cleanup after the secure copy is written.
    }
  };

  window.PLUTUS_SECURE_AUTH_STORAGE = {
    async getItem(key) {
      await ready;
      const stored = await SecureStorage.getItem(key);
      if (stored !== null) return stored;
      const legacy = legacyValue(key);
      if (legacy === null) return null;
      await SecureStorage.setItem(key, legacy);
      clearLegacyValue(key);
      return legacy;
    },
    async setItem(key, value) {
      await ready;
      await SecureStorage.setItem(key, value);
    },
    async removeItem(key) {
      await ready;
      await SecureStorage.removeItem(key);
      clearLegacyValue(key);
    },
  };
}
