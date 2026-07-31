import { createApp } from "./app";
import { assertProductionAuthConfig } from "./auth";
import { loadEnv } from "./env";
import { createDefaultStore } from "./store";
import { startQgendaScheduler } from "./qgendaScheduler";

loadEnv();
assertProductionAuthConfig();

const port = Number(process.env.PORT ?? 8787);
const store = createDefaultStore();
const app = createApp(store);

startQgendaScheduler(store, (state) => app.locals.broadcastPlannerState?.(state));

app.listen(port, () => {
  console.log(`Resident OR Coverage Planner API listening on http://localhost:${port}`);
});
