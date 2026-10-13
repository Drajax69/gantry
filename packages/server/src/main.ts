import { GantryApp } from './app.js';

const app = new GantryApp();
const running = await app.serve();
app.log.info(`Gantry dashboard: http://127.0.0.1:${running.port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      await running.close();
      process.exit(0);
    })();
  });
}
