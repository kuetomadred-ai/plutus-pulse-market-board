import { startApi } from "./api.js";
import { startWorker } from "./worker.js";

async function main() {
  const app = await startApi();
  let stopWorker: (() => Promise<void>) | undefined;
  try {
    stopWorker = await startWorker();
  } catch (error) {
    await app.close();
    throw error;
  }

  let shutdown: Promise<void> | undefined;
  const stop = () => {
    shutdown ??= (async () => {
      console.info("Stopping PLUTUS paper engine");
      try {
        await stopWorker?.();
      } finally {
        await app.close();
      }
    })();
    return shutdown;
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

main().catch((error) => {
  console.error("PLUTUS engine startup failed", error);
  process.exitCode = 1;
});
