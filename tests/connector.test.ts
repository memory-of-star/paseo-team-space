import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { PaseoApi, PaseoAgentCreateOptions } from "@getpaseo/client";
import { Store } from "../service/store";
import { createTeamServer } from "../service/http";
import { Connector } from "../server/connector";
import { LocalStorage } from "../server/storage";
import { forkPrompt } from "../server/history";
import { serviceUrl } from "../server/transport";

test("two connectors publish, fork on the recipient host, retry idempotently, and persist a withdrawal across restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "team-space-"));
  const store = new Store(join(dir, "service.db"));
  const server = createTeamServer(store, "bootstrap-secret-for-connector-test");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  const aliceStorage = new LocalStorage(join(dir, "alice"));
  const bobStorage = new LocalStorage(join(dir, "bob"));
  let alice = new Connector(aliceStorage);
  const bob = new Connector(bobStorage);
  const created: PaseoAgentCreateOptions[] = [];
  const snapshot = {
    id: "source-agent",
    title: "Design auth",
    provider: "claude",
    status: "idle",
    activeTurn: null,
  };
  const aliceApi = {
    agents: {
      ref: () => ({
        refresh: async () => ({ agent: snapshot }),
        timeline: {
          refetch: async () => ({
            epoch: "epoch",
            hasOlder: false,
            entries: [
              {
                seqStart: 1,
                item: { type: "user_message", text: "Design auth" },
              },
              {
                seqStart: 2,
                item: { type: "assistant_message", text: "Use scoped cookies" },
              },
              {
                seqStart: 3,
                item: { type: "user_message", text: "Review expiry" },
              },
              {
                seqStart: 4,
                item: { type: "assistant_message", text: "Expire at noon" },
              },
            ],
          }),
        },
      }),
    },
  } as unknown as PaseoApi;
  const bobApi = {
    agents: {
      ref: aliceApi.agents.ref,
      create: async (options: PaseoAgentCreateOptions) => {
        created.push(options);
        return { id: options.agentId };
      },
    },
  } as unknown as PaseoApi;
  alice.bind(aliceApi);
  bob.bind(bobApi);
  try {
    await alice.connect({
      kind: "create",
      url,
      name: "Alice",
      teamName: "Dev",
      bootstrapToken: "bootstrap-secret-for-connector-test",
    });
    const invite = await alice.invite();
    await bob.connect({ kind: "join", url, name: "Bob", code: invite.code });
    await alice.share("source-agent", true);
    const shared = (await bob.list())[0];
    const detail = await bob.detail(shared.id);
    const input = {
      shareId: shared.id,
      checkpointId: detail.checkpoints[0].id,
      requestKey: "retry-key",
      provider: "codex",
      question: "What about CSRF?",
    };
    const branch = await bob.fork(input);
    assert.ok(branch.agentId);
    assert.equal(created.length, 1);
    assert.match(created[0].prompt ?? "", /Use scoped cookies/);
    assert.equal(created[0].config.provider, "codex");
    assert.match(created[0].cwd, /bob\/forks/);
    assert.equal(created[0].parent, undefined);
    assert.equal((await bob.status()).shared.length, 0);
    assert.deepEqual(await bob.fork(input), branch);
    assert.equal(created.length, 1);
    await assert.rejects(
      bob.fork({ ...input, question: "different" }),
      /different input/,
    );
    const idleInput = {
      ...input,
      question: undefined,
      requestKey: "range",
      startEntryId: "epoch:3",
    };
    assert.deepEqual(await bob.forkTurns(shared.id, input.checkpointId), [
      { id: "epoch:1", preview: "Design auth" },
      { id: "epoch:3", preview: "Review expiry" },
    ]);
    const idleBranch = await bob.fork(idleInput);
    const idle = created.at(-1)!;
    assert.equal(idle.prompt, undefined);
    assert.match(idle.config.systemPrompt ?? "", /team-history.json/);
    assert.doesNotMatch(idle.config.systemPrompt ?? "", /noon/);
    assert.deepEqual(
      JSON.parse(await readFile(join(idle.cwd, "team-history.json"), "utf8")),
      [
        { role: "user", text: "Review expiry" },
        { role: "assistant", text: "Expire at noon" },
      ],
    );
    assert.deepEqual(await bob.fork(idleInput), idleBranch);
    assert.equal(created.length, 2);
    await assert.rejects(
      bob.fork({ ...idleInput, startEntryId: "epoch:1" }),
      /different input/,
    );
    await assert.rejects(
      bob.fork({ ...idleInput, requestKey: "bad", startEntryId: "epoch:4" }),
      /不在/,
    );
    assert.equal(created.length, 2);
    assert.equal((await alice.status()).shared.length, 1);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.deepEqual(await alice.share("source-agent", false), {
      pending: true,
    });
    const persisted = JSON.parse(
      await readFile(join(dir, "alice", "state.json"), "utf8"),
    );
    assert.equal(persisted.shares[0].pendingDelete, true);
    await alice.stop();
    alice = new Connector(aliceStorage);
    alice.bind(aliceApi);
    await new Promise<void>((resolve) =>
      server.listen(port, "127.0.0.1", resolve),
    );
    await alice.tick();
    assert.deepEqual(await bob.list(), []);
    assert.equal((await alice.status()).shared.length, 0);
    assert.deepEqual(await bob.fork(input), branch);
    await bob.share(branch.agentId, true);
    const bobIdentity = (await bob.status()).identity;
    assert.ok(bobIdentity);
    await alice.removeMember(bobIdentity.id);
    await bob.disconnect();
    assert.equal((await bob.status()).identity, null);
  } finally {
    await alice.stop();
    await bob.stop();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("service origins protect credentials and context limits fail explicitly", () => {
  assert.equal(serviceUrl("https://team.example"), "https://team.example");
  assert.equal(
    serviceUrl("http://47.94.77.187:18787/"),
    "http://47.94.77.187:18787",
  );
  for (const url of [
    "http://team.example",
    "http://47.94.77.187:18788",
    "blob:http://47.94.77.187:18787",
    "https://user:secret@team.example",
    "https://team.example/path",
    "https://team.example?token=secret",
  ])
    assert.throws(() => serviceUrl(url));
  assert.throws(
    () =>
      forkPrompt(
        {
          id: "a",
          origin: {
            shareId: "s",
            checkpointId: "c",
            ownerName: "A",
            title: "T",
          },
          entries: [{ id: "1", role: "user", text: "x".repeat(120_001) }],
        },
        "question",
      ),
    /never silently truncated/,
  );
});
