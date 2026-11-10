import "dotenv/config";
import app from "./app.js";
import {
  getRuntimeDatabaseUrl,
  isRestrictedRuntimeRoleUrl,
} from "./db/config.js";

const PORT = Number(process.env.PORT ?? 4000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("Invalid PORT configuration");
}

// Fail closed on startup if runtime DB config is invalid or uses privileged credentials in prod/post-cutover
const runtimeUrl = getRuntimeDatabaseUrl();
if (!isRestrictedRuntimeRoleUrl(runtimeUrl)) {
  console.warn(
    "[SECURITY WARNING] Backend is running in pre-cutover mode without restricted role npr_app_user. Complete Phase 2C cutover before production use."
  );
}

app.listen(PORT, () => {
  console.log(
    `NPR Backend running at http://localhost:${PORT}`
  );
});