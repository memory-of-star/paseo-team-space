import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store } from "../service/store";
import { createTeamServer } from "../service/http";
import {
  sessionSchema,
  shareDetailSchema,
  forkSnapshotSchema,
  type Publish,
} from "../shared/model";

const store = new Store(":memory:");
const bootstrap = "integration-bootstrap-secret-long-enough";
const server = createTeamServer(store, bootstrap);
let url: string;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
});
async function call(
  path: string,
  method = "GET",
  token?: string,
  data?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, data: (await response.json()) as unknown };
}
async function team() {
  const created = await call(
    "/v1/teams",
    "POST",
    undefined,
    { name: "Engineering", ownerName: "Alice" },
    { "X-Bootstrap-Token": bootstrap },
  );
  assert.equal(created.status, 201);
  const alice = sessionSchema.parse(created.data);
  const invite = store.invite(alice.identity);
  const joined = await call("/v1/join", "POST", undefined, {
    code: invite.code,
    name: "Bob",
  });
  assert.equal(joined.status, 201);
  return { alice, bob: sessionSchema.parse(joined.data), invite };
}
function payload(): Publish {
  return {
    deviceId: randomUUID(),
    localAgentId: randomUUID(),
    title: "Login implementation",
    provider: "claude",
    status: "idle",
    checkpoint: true,
    entries: [
      { id: "e:1", role: "user", text: "Implement login" },
      { id: "e:2", role: "assistant", text: "I suggest a session cookie." },
    ],
  };
}

test("invitations are single-use; public endpoints cannot mint memberships without a secret", async () => {
  const { invite, bob } = await team();
  assert.equal(
    (
      await call("/v1/join", "POST", undefined, {
        code: invite.code,
        name: "Mallory",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/v1/teams", "POST", undefined, {
        name: "Bad",
        ownerName: "M",
      })
    ).status,
    403,
  );
  assert.equal((await call("/v1/invites", "POST", bob.token, {})).status, 403);
  assert.equal((await call("/v1/shares")).status, 401);
});

test("teammates can read but cannot update, withdraw, message, or control someone else's shared agent", async () => {
  const { alice, bob } = await team();
  const id = randomUUID();
  const data = payload();
  assert.equal(
    (await call(`/v1/shares/${id}`, "PUT", alice.token, data)).status,
    200,
  );
  const detail = await call(`/v1/shares/${id}`, "GET", bob.token);
  assert.equal(detail.status, 200);
  assert.equal(
    shareDetailSchema.parse(detail.data).entries[1].text,
    data.entries[1].text,
  );
  assert.equal(
    (
      await call(`/v1/shares/${id}`, "PUT", bob.token, {
        ...data,
        title: "Hijacked",
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(`/v1/shares/${id}`, "DELETE", bob.token)).status,
    403,
  );
  for (const action of ["send", "stop", "permission"])
    assert.equal(
      (
        await call(`/v1/shares/${id}/${action}`, "POST", bob.token, {
          text: "Change owner work",
        })
      ).status,
      404,
    );
  assert.equal(
    (
      await call(`/v1/shares/${id}`, "PUT", alice.token, {
        ...data,
        ownerId: bob.identity.id,
      })
    ).status,
    400,
  );
});

test("team isolation applies to list, detail, fork and membership management", async () => {
  const { alice } = await team();
  const outsider = (await team()).alice;
  const id = randomUUID();
  store.publish(alice.identity, id, payload());
  assert.deepEqual((await call("/v1/shares", "GET", outsider.token)).data, []);
  assert.equal(
    (await call(`/v1/shares/${id}`, "GET", outsider.token)).status,
    404,
  );
  const cp = store.detail(alice.identity, id).checkpoints[0];
  assert.equal(
    (
      await call("/v1/forks", "POST", outsider.token, {
        id: randomUUID(),
        shareId: id,
        checkpointId: cp.id,
      })
    ).status,
    404,
  );
  await call(`/v1/members/${alice.identity.id}`, "DELETE", outsider.token);
  assert.equal((await call("/v1/me", "GET", alice.token)).status, 200);
});

test("forks use immutable completed checkpoints; active output and future turns do not change a branch", async () => {
  const { alice, bob } = await team();
  const id = randomUUID();
  const data = payload();
  store.publish(alice.identity, id, data);
  const checkpoint = store.detail(alice.identity, id).checkpoints[0];
  const forkId = randomUUID();
  const fork = await call("/v1/forks", "POST", bob.token, {
    id: forkId,
    shareId: id,
    checkpointId: checkpoint.id,
  });
  const snapshot = forkSnapshotSchema.parse(fork.data);
  assert.deepEqual(snapshot.entries, data.entries);
  store.publish(alice.identity, id, {
    ...data,
    status: "running",
    checkpoint: false,
    entries: [
      ...data.entries,
      { id: "e:3", role: "assistant", text: "unfinished" },
    ],
  });
  assert.equal(store.detail(bob.identity, id).checkpoints.length, 1);
  assert.equal(
    (
      await call("/v1/forks", "POST", bob.token, {
        id: randomUUID(),
        shareId: id,
        checkpointId: randomUUID(),
      })
    ).status,
    404,
  );
  store.unshare(alice.identity, id);
  assert.equal(
    (await call(`/v1/shares/${id}`, "PUT", alice.token, data)).status,
    409,
    "late publishes must not resurrect a withdrawn share",
  );
  assert.equal((await call(`/v1/shares/${id}`, "GET", bob.token)).status, 404);
  assert.equal(
    (
      await call("/v1/forks", "POST", bob.token, {
        id: randomUUID(),
        shareId: id,
        checkpointId: checkpoint.id,
      })
    ).status,
    404,
  );
  const retry = await call("/v1/forks", "POST", bob.token, {
    id: forkId,
    shareId: id,
    checkpointId: checkpoint.id,
  });
  assert.deepEqual(retry.data, snapshot);
  assert.equal(
    (
      await call("/v1/forks", "POST", alice.token, {
        id: forkId,
        shareId: id,
        checkpointId: checkpoint.id,
      })
    ).status,
    403,
  );
});

test("service state survives restart without storing bearer tokens in plaintext", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "team-store-"));
  let persisted = new Store(join(directory, "state.db"));
  try {
    const alice = persisted.createTeam("Durable", "Alice");
    const id = randomUUID();
    const data = payload();
    persisted.publish(alice.identity, id, data);
    assert.notEqual(
      persisted.db.prepare("SELECT token_hash FROM members").get()?.token_hash,
      alice.token,
    );
    persisted.close();
    persisted = new Store(join(directory, "state.db"));
    assert.equal(persisted.authenticate(alice.token).teamName, "Durable");
    assert.deepEqual(
      persisted.detail(alice.identity, id).entries,
      data.entries,
    );
    persisted.unshare(alice.identity, id);
    persisted.close();
    persisted = new Store(join(directory, "state.db"));
    assert.throws(
      () => persisted.publish(alice.identity, id, data),
      /withdrawn/,
    );
  } finally {
    persisted.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("revocation invalidates credentials and withdraws that member's shares", async () => {
  const { alice, bob } = await team();
  const id = randomUUID();
  store.publish(bob.identity, id, payload());
  assert.equal(
    (await call(`/v1/members/${bob.identity.id}`, "DELETE", alice.token))
      .status,
    200,
  );
  assert.equal((await call("/v1/me", "GET", bob.token)).status, 401);
  assert.equal(
    (await call(`/v1/shares/${id}`, "GET", alice.token)).status,
    404,
  );
  assert.equal(
    (await call(`/v1/members/${alice.identity.id}`, "DELETE", alice.token))
      .status,
    409,
  );
});

test("identical heartbeats do not duplicate checkpoints and a share cannot switch source", async () => {
  const { alice } = await team();
  const id = randomUUID();
  const data = payload();
  store.publish(alice.identity, id, data);
  store.publish(alice.identity, id, data);
  assert.equal(store.detail(alice.identity, id).checkpoints.length, 1);
  assert.equal(
    (
      await call(`/v1/shares/${id}`, "PUT", alice.token, {
        ...data,
        deviceId: randomUUID(),
      })
    ).status,
    409,
  );
});

test("expired invitations, malformed payloads and cross-origin requests fail closed", async () => {
  const { alice } = await team();
  const invite = store.invite(alice.identity);
  store.db.prepare("UPDATE invites SET expires_at=0").run();
  assert.equal(
    (
      await call("/v1/join", "POST", undefined, {
        code: invite.code,
        name: "Late",
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("/v1/shares/not-an-id", "PUT", alice.token, payload())).status,
    400,
  );
  assert.equal(
    (
      await call("/v1/me", "GET", alice.token, undefined, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
});
