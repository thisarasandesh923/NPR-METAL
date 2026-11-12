import "dotenv/config";
import { createApp } from "./app.js";
import { resolveSecurityConfig } from "./config/securityConfig.js";
import {
  getRuntimeDatabaseUrl,
  isRestrictedRuntimeRoleUrl,
} from "./db/config.js";
import { pool } from "./db/pool.js";

const PORT = Number(process.env.PORT ?? 4000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("Invalid PORT configuration");
}

// Fail closed on startup if runtime DB or security config is invalid
const runtimeUrl = getRuntimeDatabaseUrl();
if (!isRestrictedRuntimeRoleUrl(runtimeUrl)) {
  console.warn(
    "[SECURITY WARNING] Backend is running in pre-cutover mode without restricted role npr_app_user. Complete Phase 2C cutover before production use."
  );
}

const securityConfig = resolveSecurityConfig();
const app = createApp({ pool, securityConfig });

app.listen(PORT, () => {
  console.log(
    `NPR Backend running at http://localhost:${PORT}`
  );
});