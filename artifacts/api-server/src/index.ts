import app from "./app";
import { logger } from "./lib/logger";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeChefBilling, chefBillingStage } from "./lib/chef-stripe";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);
void initializeChefBilling().then(() => logger.info("Chef billing is ready"))
  .catch(() => logger.error({ stage: chefBillingStage }, "Chef billing setup failed; paid checkout is disabled. Free recipes remain available."));

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const pythonPort = Number(process.env.SCRAPCOOK_PY_PORT ?? 5087);
const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(serviceRoot, "../..");
const pythonExecutable = path.resolve(workspaceRoot, ".pythonlibs/bin/python");
const flaskApp = path.resolve(serviceRoot, "flask_app.py");
const pythonBackend = spawn(pythonExecutable, [flaskApp], {
  cwd: workspaceRoot,
  env: {
    ...process.env,
    SCRAPCOOK_PY_PORT: String(pythonPort),
  },
  stdio: ["ignore", "inherit", "inherit"],
});

pythonBackend.on("error", (err) => {
  logger.error({ err }, "Could not start ScrapCook Python API");
});
pythonBackend.on("exit", (code, signal) => {
  if (code !== 0 && code !== null) {
    logger.error({ code, signal }, "ScrapCook Python API exited unexpectedly");
  }
});

const stopPythonBackend = () => pythonBackend.kill("SIGTERM");
process.once("SIGINT", stopPythonBackend);
process.once("SIGTERM", stopPythonBackend);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, pythonPort }, "Server listening");
});
