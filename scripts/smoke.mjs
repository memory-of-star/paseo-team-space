import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const run = join(root, ".runtime", `smoke-${Date.now()}`);
await mkdir(run, { recursive: true });
await mkdir(join(root, "artifacts"), { recursive: true });
const fixture = join(run, "provider");
await cp(resolve(root, "../paseo/plugin-examples/provider-direct"), fixture, {
  recursive: true,
});
// This fixture spans the provider config rename between 0.15 and 0.16.
const providerFile = join(fixture, "server/provider.ts");
await writeFile(
  providerFile,
  (await readFile(providerFile, "utf8")).replace(
    "function configState(session: ExampleSession): ProviderConfigState {\n  return {",
    "function configState(session: ExampleSession): ProviderConfigState {\n  return {\n    settings: [],",
  ),
);
await writeFile(
  join(fixture, "paseo-plugin.json"),
  JSON.stringify({
    id: "provider-direct-example",
    requirements: { paseo: ">=0.15.4 <0.17.0" },
  }),
);
const children = [];
const clients = [];
async function port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
async function waitFor(fn, label) {
  let last;
  for (let i = 0; i < 120; i++) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await delay(500);
  }
  throw new Error(`${label} timed out: ${last?.message ?? "not ready"}`);
}
function start(command, args, env, log) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = createWriteStream(join(root, "artifacts", log));
  child.stdout.pipe(output);
  child.stderr.pipe(output);
  children.push(child);
  return child;
}
async function daemon(channel) {
  const home = join(run, channel);
  await mkdir(home);
  await writeFile(
    join(home, "config.json"),
    JSON.stringify({
      version: 1,
      pluginsEnabled: true,
      plugins: {
        "team-space": {
          source: "directory",
          path:
            (channel === "stable" && process.env.TEAM_LEGACY_SOURCE) ||
            process.env.TEAM_PLUGIN_SOURCE ||
            root,
          enabled: true,
        },
        "provider-direct-example": {
          source: "directory",
          path: fixture,
          enabled: true,
        },
      },
      features: {
        webUi: { enabled: true },
        dictation: { enabled: false },
        voiceMode: { enabled: false },
      },
    }),
  );
  const listen = await port();
  start(
    process.execPath,
    [
      join(
        root,
        ".runtime",
        channel,
        "node_modules/@getpaseo/cli/dist/index.js",
      ),
      "daemon",
      "run",
      "--home",
      home,
    ],
    {
      PASEO_HOME: home,
      PASEO_LISTEN: `127.0.0.1:${listen}`,
      PASEO_RELAY_ENABLED: "0",
      PASEO_TEAM_SPACE_STATE: join(home, "team-state"),
      PASEO_WEB_UI_ENABLED: "true",
    },
    `smoke-${channel}.log`,
  );
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${listen}/api/health`)).ok,
    `${channel} health`,
  );
  const { DaemonClient } = await import(
    pathToFileURL(
      join(
        root,
        ".runtime",
        channel,
        "node_modules/@getpaseo/client/dist/daemon-client.js",
      ),
    )
  );
  const { createPaseoApi } = await import(
    pathToFileURL(
      join(
        root,
        ".runtime",
        channel,
        "node_modules/@getpaseo/client/dist/index.js",
      ),
    )
  );
  const { WebSocket } = await import(
    pathToFileURL(
      join(root, ".runtime", channel, "node_modules/ws/wrapper.mjs"),
    )
  );
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${listen}/ws`,
    clientId: `team-space-smoke-${channel}`,
    webSocketFactory: (url, options) =>
      new WebSocket(url, options?.protocols, { headers: options?.headers }),
  });
  await client.connect();
  clients.push(client);
  await waitFor(async () => {
    const plugins = await client.listPlugins();
    const ours = plugins.find((plugin) => plugin.id === "team-space");
    if (ours?.error) throw new Error(JSON.stringify(ours));
    return ours?.status === "running";
  }, `${channel} plugin load`);
  console.log(`${channel}: plugin running`);
  const catalog = await client.getPluginCatalog();
  assert.ok(catalog.find((plugin) => plugin.id === "team-space")?.clientBundle);
  console.log(`${channel}: client bundle compiled`);
  const api = createPaseoApi(client);
  const call = (method, input = {}) =>
    client.invokePluginRpc("team-space", method, input);
  assert.equal((await call("team.status")).identity, null);
  return { client, api, call, listen, home };
}
try {
  const bootstrap = randomBytes(32).toString("hex");
  const servicePort = await port();
  start(
    process.execPath,
    [join(root, "dist/team-service.mjs")],
    {
      TEAM_BOOTSTRAP_TOKEN: bootstrap,
      TEAM_PORT: String(servicePort),
      TEAM_DB: join(run, "team.db"),
    },
    "smoke-service.log",
  );
  const serviceUrl = `http://127.0.0.1:${servicePort}`;
  await waitFor(
    async () => (await fetch(`${serviceUrl}/health`)).ok,
    "team service",
  );
  const alice = await daemon("stable");
  const bob = await daemon("beta");
  await alice.call("team.connect", {
    kind: "create",
    url: serviceUrl,
    name: "Alice",
    teamName: "Platform team",
    bootstrapToken: bootstrap,
  });
  const invite = await alice.call("team.invite");
  await bob.call("team.connect", {
    kind: "join",
    url: serviceUrl,
    name: "Bob",
    code: invite.code,
  });
  const source = await alice.api.agents.create({
    config: { provider: "direct-example/example-1" },
    cwd: alice.home,
    title: "Login design review",
    prompt: "Review login sessions, cookie scope and CSRF protection.",
  });
  await source.waitForFinish({ timeoutMs: 15_000 });
  await source.send("Focus on rotating cookies each week.");
  await source.waitForFinish({ timeoutMs: 15_000 });
  await alice.call("team.share", { agentId: source.id, enabled: true });
  const list = await bob.call("team.list");
  assert.equal(list.length, 1);
  const detail = await bob.call("team.detail", { shareId: list[0].id });
  assert.ok(detail.entries.some((entry) => entry.text.includes("CSRF")));
  assert.ok(detail.checkpoints.length);
  const original = await source.timeline.refetch();
  const params = {
    shareId: list[0].id,
    checkpointId: detail.checkpoints[0].id,
  };
  const turns = await bob.call("team.fork-turns", params);
  assert.equal(turns.length, 2);
  assert.match(turns[1].preview, /rotating cookies/);
  const models = await bob.call("team.fork-models", {
    provider: "direct-example",
  });
  assert.equal(models[0].id, "example-1");
  const fork = await bob.call("team.fork", {
    shareId: list[0].id,
    checkpointId: detail.checkpoints[0].id,
    requestKey: "smoke-fork",
    provider: "direct-example/example-1",
    startEntryId: turns[1].id,
  });
  const branch = bob.api.agents.ref(fork.agentId);
  const idle = await branch.refresh();
  assert.equal(idle.agent.status, "idle");
  assert.equal(idle.agent.activeTurn, null);
  assert.ok(
    !(await branch.timeline.refetch()).entries.some(({ item }) =>
      ["user_message", "assistant_message"].includes(item.type),
    ),
  );
  const saved = JSON.parse(
    await readFile(join(idle.agent.cwd, "team-history.json"), "utf8"),
  );
  assert.deepEqual(
    saved,
    detail.entries
      .slice(detail.entries.findIndex((e) => e.id === turns[1].id))
      .map(({ role, text }) => ({ role, text })),
  );
  await branch.send("How should the session cookie expire?");
  await branch.waitForFinish({ timeoutMs: 15_000 });
  const history = await branch.timeline.refetch();
  assert.ok(
    history.entries.some(
      ({ item }) =>
        item.type === "assistant_message" &&
        item.text.includes("cookie expire"),
    ),
  );
  assert.deepEqual(
    (await source.timeline.refetch()).entries.map((row) => row.item),
    original.entries.map((row) => row.item),
  );
  assert.equal((await bob.call("team.status")).shared.length, 0);
  console.log(
    "stable → beta: shared history, private recipient-host fork, original history unchanged",
  );
  await bob.call("team.share", { agentId: fork.agentId, enabled: true });
  assert.equal((await alice.call("team.list")).length, 2);
  const other = (await alice.call("team.list")).find(
    (item) => item.id !== list[0].id,
  );
  const fromBob = await alice.call("team.detail", { shareId: other.id });
  const legacyFork = await alice.call("team.fork", {
    shareId: other.id,
    checkpointId: fromBob.checkpoints[0].id,
    requestKey: "old-client-fork",
    provider: "direct-example/example-1",
    question: "Legacy fork question",
  });
  await alice.api.agents
    .ref(legacyFork.agentId)
    .waitForFinish({ timeoutMs: 15_000 });
  console.log(
    "Idle range fork, user-initiated first turn and reverse legacy fork passed",
  );
  await alice.call("team.share", { agentId: source.id, enabled: false });
  await assert.rejects(bob.call("team.detail", { shareId: list[0].id }));
  assert.equal((await bob.call("team.list")).length, 1);
  console.log(
    "withdrawal: source inaccessible; independently shared branch survives",
  );
  const report = {
    createdAt: new Date().toISOString(),
    sourceCommit: "ee6a2bba77dcb2cd11a52d135cbecfcfdc303941",
    stable: "0.15.4",
    beta: "0.16.0-beta.1",
    pluginSource: process.env.TEAM_PLUGIN_SOURCE ?? root,
    alicePort: alice.listen,
    bobPort: bob.listen,
    servicePort,
    run,
    sourceAgent: source.id,
    branchAgent: fork.agentId,
    checks: [
      "plugin runtime",
      "client bundle compilation",
      "cross-version sharing",
      "recipient-host fork",
      "source unchanged",
      "private branch default",
      "withdrawal",
      "branch survival",
    ],
  };
  await writeFile(
    join(root, "artifacts/smoke-report.json"),
    JSON.stringify(report, null, 2),
  );
  if (process.env.SMOKE_KEEP === "1") {
    console.log(
      "Ready for browser checks",
      JSON.stringify({ alicePort: alice.listen, bobPort: bob.listen }),
    );
    await new Promise((resolve) => process.on("SIGTERM", resolve));
  }
} finally {
  for (const client of clients) await client.close();
  for (const child of children.reverse()) child.kill("SIGTERM");
  await delay(1000);
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGKILL");
}
