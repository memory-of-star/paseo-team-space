import { createServer, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import { idSchema, publishSchema, PROTOCOL_VERSION } from "../shared/model";
import { HttpError, Store, hash } from "./store";

async function body(req: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    const bytes = Buffer.from(part);
    size += bytes.length;
    if (size > 2_500_000) throw new HttpError(413, "Request body is too large");
    parts.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new HttpError(400, "Expected JSON request body");
  }
}

export function createTeamServer(store: Store, bootstrapToken: string) {
  const attempts = new Map<string, { count: number; reset: number }>();
  return createServer(
    { requestTimeout: 15_000, headersTimeout: 10_000 },
    async (req, res) => {
      const send = (status: number, value: unknown) => {
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(JSON.stringify(value));
      };
      try {
        if (req.headers.origin)
          throw new HttpError(
            403,
            "Use the authenticated Paseo plugin to access this service",
          );
        const path = new URL(req.url ?? "/", "http://localhost").pathname;
        const method = req.method;
        if (method === "GET" && path === "/health")
          return send(200, { protocol: PROTOCOL_VERSION });
        const addr = req.socket.remoteAddress ?? "unknown";
        const now = Date.now();
        if (attempts.size > 10_000)
          for (const [ip, item] of attempts)
            if (item.reset < now) attempts.delete(ip);
        const rate = attempts.get(addr);
        if (rate && rate.reset > now) {
          if (++rate.count > 600)
            throw new HttpError(429, "Too many requests; retry in one minute");
        } else attempts.set(addr, { count: 1, reset: now + 60_000 });
        if (method === "POST" && path === "/v1/teams") {
          const received = req.headers["x-bootstrap-token"];
          if (
            !bootstrapToken ||
            typeof received !== "string" ||
            !timingSafeEqual(
              Buffer.from(hash(received)),
              Buffer.from(hash(bootstrapToken)),
            )
          )
            throw new HttpError(403, "Invalid service bootstrap token");
          const input = z
            .object({
              name: z.string().trim().min(1).max(80),
              ownerName: z.string().trim().min(1).max(80),
            })
            .strict()
            .parse(await body(req));
          return send(201, store.createTeam(input.name, input.ownerName));
        }
        if (method === "POST" && path === "/v1/join") {
          const input = z
            .object({
              code: z.string().min(20).max(200),
              name: z.string().trim().min(1).max(80),
            })
            .strict()
            .parse(await body(req));
          return send(201, store.join(input.code, input.name));
        }
        const auth = req.headers.authorization;
        if (!auth?.startsWith("Bearer "))
          throw new HttpError(401, "Team login required");
        const who = store.authenticate(auth.slice(7));
        if (method === "GET" && path === "/v1/me") return send(200, who);
        if (method === "POST" && path === "/v1/invites")
          return send(201, store.invite(who));
        if (method === "GET" && path === "/v1/members")
          return send(200, store.members(who));
        const member = path.match(/^\/v1\/members\/([^/]+)$/);
        if (method === "DELETE" && member) {
          store.removeMember(who, idSchema.parse(member[1]));
          return send(200, { ok: true });
        }
        if (method === "GET" && path === "/v1/shares")
          return send(200, store.list(who));
        const share = path.match(/^\/v1\/shares\/([^/]+)$/);
        if (share) {
          const id = idSchema.parse(share[1]);
          if (method === "GET") return send(200, store.detail(who, id));
          if (method === "PUT")
            return send(
              200,
              store.publish(who, id, publishSchema.parse(await body(req))),
            );
          if (method === "DELETE") {
            store.unshare(who, id);
            return send(200, { ok: true });
          }
        }
        if (method === "POST" && path === "/v1/forks") {
          const input = z
            .object({ id: idSchema, shareId: idSchema, checkpointId: idSchema })
            .strict()
            .parse(await body(req));
          return send(
            201,
            store.fork(who, input.id, input.shareId, input.checkpointId),
          );
        }
        throw new HttpError(404, "Route not found");
      } catch (error) {
        if (error instanceof HttpError)
          return send(error.status, { error: error.message });
        if (error instanceof ZodError)
          return send(400, {
            error: "Invalid request",
            details: error.issues.map((issue) => ({
              path: issue.path,
              message: issue.message,
            })),
          });
        console.error(
          "Team service request failed",
          error instanceof Error ? error.name : "Unknown error",
        );
        send(500, { error: "Internal service error" });
      }
    },
  );
}
