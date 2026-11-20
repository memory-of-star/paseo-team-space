import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PaseoApi } from "./paseo-types";
import type { RpcInput } from "@getpaseo/plugin";
import { z } from "zod";
import {
  forkSnapshotSchema,
  identitySchema,
  memberSchema,
  originSchema,
  sessionSchema,
  shareDetailSchema,
  shareSummarySchema,
  type Publish,
} from "../shared/model";
import type { connectRpc, forkRpc } from "../shared/rpc";
import { LocalStorage, type LocalState } from "./storage";
import { request, serviceUrl, ServiceError } from "./transport";
import { readHistory, forkPrompt } from "./history";

const okSchema = z.object({ ok: z.boolean() });
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Team operation failed";
export class Connector {
  private state: LocalState | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private api: PaseoApi | undefined;
  private stopped = false;
  private syncing = false;
  private lastError: string | null = null;
  private errors = new Map<string, string>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private storage = new LocalStorage()) {
    this.timer = setInterval(() => {
      void this.tick();
    }, 3_000);
    this.timer.unref();
  }
  bind(api: PaseoApi) {
    this.api = api;
  }
  private serial<T>(fn: (state: LocalState) => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      if (this.stopped) throw new Error("Team plugin is stopping");
      this.state ??= await this.storage.read();
      return fn(this.state);
    });
    this.queue = task.catch(() => {});
    return task;
  }
  private remote<T>(
    state: LocalState,
    path: string,
    schema: z.ZodType<T>,
    method = "GET",
    body?: unknown,
  ) {
    if (!state.identity || !state.token)
      throw new Error("Join or create a team first");
    return request(state.url, path, schema, {
      token: state.token,
      method,
      body,
    });
  }
  status() {
    return this.serial(async (state) => ({
      identity: state.identity,
      url: state.url,
      error: this.lastError,
      shared: state.shares.map((share) => ({
        ...share,
        error: this.errors.get(share.shareId) ?? null,
      })),
    }));
  }
  connect(input: RpcInput<typeof connectRpc>) {
    return this.serial(async (state) => {
      if (state.identity)
        throw new Error("Disconnect the current team before joining another");
      const url = serviceUrl(input.url);
      const session =
        input.kind === "create"
          ? await request(url, "/v1/teams", sessionSchema, {
              method: "POST",
              bootstrapToken: input.bootstrapToken,
              body: { name: input.teamName, ownerName: input.name },
            })
          : await request(url, "/v1/join", sessionSchema, {
              method: "POST",
              body: { code: input.code, name: input.name },
            });
      state.url = url;
      state.token = session.token;
      state.identity = session.identity;
      await this.storage.write(state);
      this.lastError = null;
      return session.identity;
    });
  }
  list() {
    return this.serial((state) =>
      this.remote(state, "/v1/shares", z.array(shareSummarySchema)),
    );
  }
  detail(id: string) {
    return this.serial((state) =>
      this.remote(state, `/v1/shares/${id}`, shareDetailSchema),
    );
  }
  invite() {
    return this.serial((state) =>
      this.remote(
        state,
        "/v1/invites",
        z.object({ code: z.string(), expiresAt: z.number() }),
        "POST",
        {},
      ),
    );
  }
  members() {
    return this.serial((state) =>
      this.remote(state, "/v1/members", z.array(memberSchema)),
    );
  }
  removeMember(id: string) {
    return this.serial((state) =>
      this.remote(state, `/v1/members/${id}`, okSchema, "DELETE"),
    );
  }
  local() {
    return this.serial(async (state) => {
      const api = this.requireApi();
      let result = await api.agents.list({
        filter: { includeArchived: false },
        page: { limit: 200 },
        sort: [{ key: "created_at", direction: "asc" }],
      });
      const entries = [...result.entries];
      while (result.pageInfo.hasMore) {
        if (!result.pageInfo.nextCursor)
          throw new Error(
            "Agent list pagination is unavailable; update the Paseo host",
          );
        result = await api.agents.list({
          filter: { includeArchived: false },
          page: { limit: 200, cursor: result.pageInfo.nextCursor },
          sort: [{ key: "created_at", direction: "asc" }],
        });
        entries.push(...result.entries);
      }
      return entries.map(({ agent }) => {
        const fork = Object.values(state.forks).find(
          (item) => item.agentId === agent.id,
        );
        return {
          id: agent.id,
          title: agent.title ?? agent.id,
          status: agent.status,
          provider: agent.provider,
          origin: fork?.origin,
        };
      });
    });
  }
  share(agentId: string, enabled: boolean) {
    return this.serial(async (state) => {
      if (!state.identity) throw new Error("Join a team first");
      let share = state.shares.find((item) => item.agentId === agentId);
      if (enabled) {
        if (share?.pendingDelete)
          throw new Error("Wait for withdrawal to finish before sharing again");
        if (!share) {
          share = { agentId, shareId: randomUUID(), pendingDelete: false };
          state.shares.push(share);
          await this.storage.write(state);
        }
        await this.publish(state, share);
        return { pending: false };
      }
      if (!share) return { pending: false };
      // Persist the tombstone before contacting the service, including when offline.
      share.pendingDelete = true;
      await this.storage.write(state);
      try {
        await this.withdraw(state, share.shareId);
        return { pending: false };
      } catch (error) {
        this.errors.set(share.shareId, message(error));
        return { pending: true };
      }
    });
  }
  private async withdraw(state: LocalState, shareId: string) {
    await this.remote(state, `/v1/shares/${shareId}`, okSchema, "DELETE");
    state.shares = state.shares.filter((item) => item.shareId !== shareId);
    this.errors.delete(shareId);
    await this.storage.write(state);
  }
  private async publish(
    state: LocalState,
    share: LocalState["shares"][number],
  ) {
    const agent = this.requireApi().agents.ref(share.agentId);
    const before = await agent.refresh();
    if (!before) {
      share.pendingDelete = true;
      await this.storage.write(state);
      await this.withdraw(state, share.shareId);
      return;
    }
    const entries = await readHistory(agent);
    const after = await agent.refresh();
    if (!after) return;
    const origin = Object.values(state.forks).find(
      (fork) => fork.agentId === share.agentId,
    )?.origin;
    const payload: Publish = {
      deviceId: state.deviceId,
      localAgentId: share.agentId,
      title: after.agent.title ?? "Untitled agent",
      provider: after.agent.provider,
      status: after.agent.status,
      entries,
      checkpoint:
        before.agent.status === "idle" &&
        after.agent.status === "idle" &&
        !before.agent.activeTurn &&
        !after.agent.activeTurn &&
        before.agent.updatedAt === after.agent.updatedAt &&
        before.agent.lastUserMessageAt === after.agent.lastUserMessageAt &&
        entries.at(-1)?.role === "assistant",
      ...(origin ? { origin } : {}),
    };
    await this.remote(
      state,
      `/v1/shares/${share.shareId}`,
      okSchema,
      "PUT",
      payload,
    );
    this.errors.delete(share.shareId);
  }
  fork(input: RpcInput<typeof forkRpc>) {
    return this.serial(async (state) => {
      let operation = state.forks[input.requestKey];
      if (
        operation &&
        (operation.shareId !== input.shareId ||
          operation.checkpointId !== input.checkpointId ||
          operation.question !== input.question ||
          operation.provider !== input.provider)
      )
        throw new Error(
          "This fork request was already used with different input; start a new fork",
        );
      if (!operation) {
        operation = {
          id: randomUUID(),
          agentId: randomUUID(),
          shareId: input.shareId,
          checkpointId: input.checkpointId,
          provider: input.provider,
          question: input.question,
          done: false,
        };
        state.forks[input.requestKey] = operation;
        await this.storage.write(state);
      }
      if (operation.done && operation.origin)
        return { agentId: operation.agentId, origin: operation.origin };
      const snapshot = await this.remote(
        state,
        "/v1/forks",
        forkSnapshotSchema,
        "POST",
        {
          id: operation.id,
          shareId: input.shareId,
          checkpointId: input.checkpointId,
        },
      );
      const prompt = forkPrompt(snapshot, input.question);
      const cwd = join(this.storage.directory, "forks", operation.id);
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      const agent = await this.requireApi().agents.create({
        idempotencyKey: `team-fork-${operation.id}`,
        agentId: operation.agentId,
        config: { provider: input.provider },
        cwd,
        title: `Fork: ${snapshot.origin.title}`.slice(0, 200),
        prompt,
        labels: {
          "team-space.source": input.shareId,
          "team-space.checkpoint": input.checkpointId,
        },
      });
      operation.agentId = agent.id;
      operation.origin = originSchema.parse(snapshot.origin);
      operation.done = true;
      await this.storage.write(state);
      return { agentId: agent.id, origin: snapshot.origin };
    });
  }
  disconnect() {
    return this.serial(async (state) => {
      for (const share of state.shares) share.pendingDelete = true;
      await this.storage.write(state);
      try {
        for (const share of [...state.shares])
          await this.withdraw(state, share.shareId);
      } catch (error) {
        // Membership revocation already cascades deletion of the member's server shares.
        if (!(error instanceof ServiceError && error.status === 401))
          throw error;
        state.shares = [];
      }
      state.identity = null;
      state.token = "";
      state.url = "";
      await this.storage.write(state);
      this.lastError = null;
      return { ok: true };
    });
  }
  async tick() {
    if (this.syncing || this.stopped || !this.api) return;
    this.syncing = true;
    try {
      await this.serial(async (state) => {
        if (!state.identity) return;
        await this.remote(state, "/v1/me", identitySchema);
        for (const share of [...state.shares]) {
          try {
            if (share.pendingDelete) await this.withdraw(state, share.shareId);
            else await this.publish(state, share);
          } catch (error) {
            this.errors.set(share.shareId, message(error));
          }
        }
        this.lastError = null;
      });
    } catch (error) {
      this.lastError = message(error);
    } finally {
      this.syncing = false;
    }
  }
  private requireApi() {
    if (!this.api) throw new Error("Paseo connection is not ready");
    return this.api;
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.queue;
  }
}
