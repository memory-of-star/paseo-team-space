import { mkdirSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Store } from "./store";
import { createTeamServer } from "./http";

const token = process.env.TEAM_BOOTSTRAP_TOKEN;
if (!token || token.length < 24)
  throw new Error(
    "Set TEAM_BOOTSTRAP_TOKEN to a random secret of at least 24 characters",
  );
process.umask(0o077);
const file = resolve(process.env.TEAM_DB ?? ".runtime/team.db");
mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
const store = new Store(file);
chmodSync(file, 0o600);
const port = Number(process.env.TEAM_PORT ?? 8787);
const host = process.env.TEAM_HOST ?? "127.0.0.1";
const server = createTeamServer(store, token);
server.listen(port, host, () =>
  console.log(`Team service listening on ${host}:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
