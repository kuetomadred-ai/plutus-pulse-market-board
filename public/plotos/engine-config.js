// Set this to the deployed backend origin (for example: https://api.example.com).
// Empty means fail-closed: trading is disabled; the client never falls back to local execution.
window.PLUTUS_ENGINE_API_URL = window.PLUTUS_NATIVE ? "" : window.location.origin;
// Optional HTTPS origin serving /api/public/payments/* for native builds. Web builds use same-origin.
// Leave blank until your own application server is deployed; payments then fail closed in native builds.
window.PLUTUS_PAYMENTS_API_URL = "";
