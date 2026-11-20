import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  idSchema,
  identitySchema,
  memberSchema,
  originSchema,
  shareDetailSchema,
  shareSummarySchema,
} from "./model";

const empty = z.object({});
export const statusRpc = defineRpc({
  name: "team.status",
  input: empty,
  output: z.object({
    identity: identitySchema.nullable(),
    url: z.string(),
    error: z.string().nullable(),
    shared: z.array(
      z.object({
        agentId: z.string(),
        shareId: idSchema,
        pendingDelete: z.boolean(),
        error: z.string().nullable(),
      }),
    ),
  }),
});
export const connectRpc = defineRpc({
  name: "team.connect",
  input: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("create"),
      url: z.string(),
      name: z.string(),
      teamName: z.string(),
      bootstrapToken: z.string(),
    }),
    z.object({
      kind: z.literal("join"),
      url: z.string(),
      name: z.string(),
      code: z.string(),
    }),
  ]),
  output: identitySchema,
});
export const listRpc = defineRpc({
  name: "team.list",
  input: empty,
  output: z.array(shareSummarySchema),
});
export const detailRpc = defineRpc({
  name: "team.detail",
  input: z.object({ shareId: idSchema }),
  output: shareDetailSchema,
});
export const shareRpc = defineRpc({
  name: "team.share",
  input: z.object({ agentId: z.string().min(1), enabled: z.boolean() }),
  output: z.object({ pending: z.boolean() }),
});
export const inviteRpc = defineRpc({
  name: "team.invite",
  input: empty,
  output: z.object({ code: z.string(), expiresAt: z.number() }),
});
export const membersRpc = defineRpc({
  name: "team.members",
  input: empty,
  output: z.array(memberSchema),
});
export const removeMemberRpc = defineRpc({
  name: "team.remove-member",
  input: z.object({ memberId: idSchema }),
  output: z.object({ ok: z.boolean() }),
});
export const disconnectRpc = defineRpc({
  name: "team.disconnect",
  input: empty,
  output: z.object({ ok: z.boolean() }),
});
export const localRpc = defineRpc({
  name: "team.local-agents",
  input: empty,
  output: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      provider: z.string(),
      origin: originSchema.optional(),
    }),
  ),
});
export const forkTurnsRpc = defineRpc({
  name: "team.fork-turns",
  input: z.object({ shareId: idSchema, checkpointId: idSchema }),
  output: z.array(z.object({ id: z.string(), preview: z.string() })),
});
export const forkModelsRpc = defineRpc({
  name: "team.fork-models",
  input: z.object({ provider: z.string().trim().min(1).max(200) }),
  output: z.array(z.object({ id: z.string(), label: z.string() })),
});
export const forkRpc = defineRpc({
  name: "team.fork",
  input: z.object({
    shareId: idSchema,
    checkpointId: idSchema,
    requestKey: z.string().min(1).max(200),
    provider: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(20_000).optional(),
    startEntryId: z.string().min(1).max(200).optional(),
  }),
  output: z.object({ agentId: z.string(), origin: originSchema }),
});
