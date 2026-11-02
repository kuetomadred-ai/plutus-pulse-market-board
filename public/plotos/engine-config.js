// Production backend for native Android/iOS builds. The URL is public; authentication
// still requires a verified Supabase/demo token and the server remains authoritative.
window.PLUTUS_ENGINE_API_URL = window.PLUTUS_NATIVE
  ? "https://gold-price-compass.lovable.app/api/public/engine"
  : window.location.origin;
window.PLUTUS_SUPABASE_URL = window.PLUTUS_SUPABASE_URL ||
  "https://c--dfcd02c1-396d-4f73-8066-f696bf93052a-prod.lovable.cloud";
window.PLUTUS_SUPABASE_PUBLISHABLE_KEY = window.PLUTUS_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_6LFr7m9ecDgx_g8-LhCkxg_Juv53e6C";
// Payments remain fail-closed until a separately reviewed payment origin is enabled.
window.PLUTUS_PAYMENTS_API_URL = "";
