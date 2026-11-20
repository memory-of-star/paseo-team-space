import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PROTOCOL_VERSION,
  publishSchema,
  type Identity,
  type Publish,
  type ForkSnapshot,
} from "../shared/model";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const memberRow = z.object({
  id: z.string(),
  team_id: z.string(),
  name: z.string(),
  role: z.enum(["admin", "member"]),
  team_name: z.string(),
});
const shareRow = z.object({
  id: z.string(),
  team_id: z.string(),
  owner_id: z.string(),
  owner_name: z.string(),
  payload: z.string(),
  updated_at: z.number(),
});
const checkpointRow = z.object({
  id: z.string(),
  share_id: z.string(),
  payload: z.string(),
  created_at: z.number(),
  digest: z.string(),
});

export class Store {
  readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), name TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (digest TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), owner_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE, payload TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS forks (id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS withdrawals (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, team_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS share_team ON shares(team_id);
      CREATE INDEX IF NOT EXISTS checkpoint_share ON checkpoints(share_id);
      PRAGMA user_version = 1;`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  createTeam(name: string, ownerName: string) {
    return this.transaction(() => {
      const teamId = randomUUID();
      this.db.prepare("INSERT INTO teams VALUES (?, ?)").run(teamId, name);
      return this.addMember(teamId, ownerName, "admin");
    });
  }
  private addMember(teamId: string, name: string, role: "admin" | "member") {
    const token = secret();
    this.db
      .prepare("INSERT INTO members VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), teamId, name, role, hash(token));
    return { token, identity: this.authenticate(token) };
  }
  authenticate(token: string): Identity {
    const raw = this.db
      .prepare(
        "SELECT m.*, t.name AS team_name FROM members m JOIN teams t ON t.id=m.team_id WHERE token_hash=?",
      )
      .get(hash(token));
    if (!raw)
      throw new HttpError(
        401,
        "Team credentials are invalid or membership was revoked",
      );
    const row = memberRow.parse(raw);
    return {
      id: row.id,
      teamId: row.team_id,
      name: row.name,
      role: row.role,
      teamName: row.team_name,
      protocol: PROTOCOL_VERSION,
    };
  }
  invite(who: Identity) {
    this.requireAdmin(who);
    const code = secret();
    const expiresAt = Date.now() + 86_400_000;
    this.db.prepare("DELETE FROM invites WHERE expires_at < ?").run(Date.now());
    this.db
      .prepare("INSERT INTO invites VALUES (?, ?, ?)")
      .run(hash(code), who.teamId, expiresAt);
    return { code, expiresAt };
  }
  join(code: string, name: string) {
    return this.transaction(() => {
      const raw = this.db
        .prepare("SELECT * FROM invites WHERE digest=? AND expires_at>?")
        .get(hash(code), Date.now());
      if (!raw)
        throw new HttpError(
          403,
          "Invitation is invalid, expired, or already used",
        );
      const row = z.object({ team_id: z.string() }).parse(raw);
      this.db.prepare("DELETE FROM invites WHERE digest=?").run(hash(code));
      return this.addMember(row.team_id, name, "member");
    });
  }
  members(who: Identity) {
    return this.db
      .prepare(
        "SELECT id, name, role FROM members WHERE team_id=? ORDER BY name",
      )
      .all(who.teamId);
  }
  removeMember(who: Identity, id: string) {
    this.requireAdmin(who);
    if (id === who.id)
      throw new HttpError(
        409,
        "The team owner cannot remove their own membership",
      );
    this.db
      .prepare("DELETE FROM members WHERE id=? AND team_id=?")
      .run(id, who.teamId);
  }
  private requireAdmin(who: Identity) {
    if (who.role !== "admin")
      throw new HttpError(403, "Only the team owner can manage membership");
  }
  private row(who: Identity, id: string) {
    const raw = this.db
      .prepare(
        "SELECT s.*, m.name AS owner_name FROM shares s JOIN members m ON m.id=s.owner_id WHERE s.id=? AND s.team_id=?",
      )
      .get(id, who.teamId);
    if (!raw) throw new HttpError(404, "Shared agent is unavailable");
    return shareRow.parse(raw);
  }
  private summary(row: z.infer<typeof shareRow>) {
    const payload = publishSchema.parse(JSON.parse(row.payload));
    return {
      id: row.id,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      title: payload.title,
      provider: payload.provider,
      status: payload.status,
      updatedAt: row.updated_at,
      online: Date.now() - row.updated_at < 20_000,
      origin: payload.origin,
    };
  }
  list(who: Identity) {
    return this.db
      .prepare(
        "SELECT s.*, m.name AS owner_name FROM shares s JOIN members m ON m.id=s.owner_id WHERE s.team_id=? ORDER BY s.updated_at DESC",
      )
      .all(who.teamId)
      .map((raw) => this.summary(shareRow.parse(raw)));
  }
  detail(who: Identity, id: string) {
    const row = this.row(who, id);
    const checkpoints = this.db
      .prepare(
        "SELECT * FROM checkpoints WHERE share_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100",
      )
      .all(id)
      .map((raw) => {
        const cp = checkpointRow.parse(raw);
        return {
          id: cp.id,
          createdAt: cp.created_at,
          entryCount: publishSchema.parse(JSON.parse(cp.payload)).entries
            .length,
        };
      });
    return {
      ...this.summary(row),
      entries: publishSchema.parse(JSON.parse(row.payload)).entries,
      checkpoints,
    };
  }
  publish(who: Identity, id: string, payload: Publish) {
    return this.transaction(() => {
      if (this.db.prepare("SELECT id FROM withdrawals WHERE id=?").get(id))
        throw new HttpError(
          409,
          "This share was withdrawn; create a new share to publish again",
        );
      const existing = this.db
        .prepare("SELECT owner_id, team_id, payload FROM shares WHERE id=?")
        .get(id);
      if (existing) {
        const row = z
          .object({
            owner_id: z.string(),
            team_id: z.string(),
            payload: z.string(),
          })
          .parse(existing);
        if (row.owner_id !== who.id || row.team_id !== who.teamId)
          throw new HttpError(
            403,
            "Only the agent owner can update this share",
          );
        const previous = publishSchema.parse(JSON.parse(row.payload));
        if (
          previous.deviceId !== payload.deviceId ||
          previous.localAgentId !== payload.localAgentId
        )
          throw new HttpError(409, "A share cannot change its source agent");
      }
      const now = Date.now();
      this.db
        .prepare(
          "INSERT INTO shares VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
        )
        .run(id, who.teamId, who.id, JSON.stringify(payload), now);
      if (payload.checkpoint && payload.entries.length) {
        const digest = hash(JSON.stringify(payload.entries));
        const last = this.db
          .prepare(
            "SELECT digest FROM checkpoints WHERE share_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
          )
          .get(id);
        if (!last || last.digest !== digest) {
          this.db
            .prepare("INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?)")
            .run(randomUUID(), id, JSON.stringify(payload), digest, now);
          this.db
            .prepare(
              "DELETE FROM checkpoints WHERE share_id=? AND id NOT IN (SELECT id FROM checkpoints WHERE share_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100)",
            )
            .run(id, id);
        }
      }
      return { ok: true as const };
    });
  }
  unshare(who: Identity, id: string) {
    const existing = this.db
      .prepare("SELECT owner_id, team_id FROM shares WHERE id=?")
      .get(id);
    if (
      existing &&
      (existing.owner_id !== who.id || existing.team_id !== who.teamId)
    )
      throw new HttpError(403, "Only the agent owner can withdraw this share");
    this.transaction(() => {
      // A timed-out, delayed publish must never resurrect a withdrawn conversation.
      this.db
        .prepare("INSERT OR IGNORE INTO withdrawals VALUES (?, ?, ?)")
        .run(id, who.id, who.teamId);
      this.db.prepare("DELETE FROM shares WHERE id=?").run(id);
    });
  }
  fork(
    who: Identity,
    id: string,
    shareId: string,
    checkpointId: string,
  ): ForkSnapshot {
    // A successfully captured fork survives withdrawal, but is private to its creator.
    const existing = this.db
      .prepare("SELECT member_id, payload FROM forks WHERE id=?")
      .get(id);
    if (existing) {
      if (existing.member_id !== who.id)
        throw new HttpError(403, "Fork belongs to another member");
      const saved = JSON.parse(
        z.string().parse(existing.payload),
      ) as ForkSnapshot;
      if (
        saved.origin.shareId !== shareId ||
        saved.origin.checkpointId !== checkpointId
      )
        throw new HttpError(409, "Fork request ID was already used");
      return saved;
    }
    const share = this.row(who, shareId);
    const raw = this.db
      .prepare("SELECT * FROM checkpoints WHERE id=? AND share_id=?")
      .get(checkpointId, shareId);
    if (!raw) throw new HttpError(404, "Completed checkpoint is unavailable");
    const cp = checkpointRow.parse(raw);
    const payload = publishSchema.parse(JSON.parse(cp.payload));
    const result: ForkSnapshot = {
      id,
      origin: {
        shareId,
        checkpointId,
        ownerName: share.owner_name,
        title: payload.title,
      },
      entries: payload.entries,
    };
    this.db
      .prepare("INSERT INTO forks VALUES (?, ?, ?, ?)")
      .run(id, who.id, JSON.stringify(result), Date.now());
    return result;
  }
  close() {
    this.db.close();
  }
}
