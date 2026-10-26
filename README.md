# Plutus Pulse Market Board

استيراد وبناء تطبيق منصة التداول PLUTUS من مستودع https://github.com/kuetomadred-ai/hello-world-helper وتشغيل شاشة المعاينة الحية والتفاعلية للتطبيق مع شاشات الرسوم البيانية وقائمة الأسعار وإعداد محرك التداول وقاعدة البيانات.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://plutus-pulse-market-board.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/54126d39-5659-4b36-87a8-0df734663018).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Background engine

Trading state is stored server-side in Supabase and does not depend on the app staying open. For free scheduled processing of pending orders, SL/TP, and risk checks between sessions, deploy the `supabase/functions/engine-worker` Edge Function and schedule it with `pg_cron`; see [docs/BACKGROUND_ENGINE.md](docs/BACKGROUND_ENGINE.md). The backend WebSocket worker remains optional for lower-latency quote processing.
