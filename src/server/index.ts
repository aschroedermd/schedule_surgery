import { createApp } from "./app";
import { assertProductionAuthConfig } from "./auth";
import { loadEnv } from "./env";
import { createDefaultStore } from "./store";

loadEnv();
assertProductionAuthConfig();

const port = Number(process.env.PORT ?? 8787);
const app = createApp(createDefaultStore());

app.listen(port, () => {
  console.log(`Resident OR Coverage Planner API listening on http://localhost:${port}`);
});
