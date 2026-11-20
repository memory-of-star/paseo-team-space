import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const idSchema = z.string().uuid();
export const entrySchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(["user", "assistant", "tool", "notice"]),
  text: z.string().max(100_000),
});
export const transcriptSchema = z
  .array(entrySchema)
  .max(10_000)
  .refine(
    (entries) =>
      entries.reduce((size, entry) => size + entry.text.length, 0) <= 500_000,
    "Conversation exceeds the 500,000 character sharing limit",
  );
export const originSchema = z.object({
  shareId: idSchema,
  checkpointId: idSchema,
  ownerName: z.string(),
  title: z.string(),
});
export const publishSchema = z
  .object({
    deviceId: idSchema,
    localAgentId: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    provider: z.string().max(200),
    status: z.string().max(80),
    entries: transcriptSchema,
    checkpoint: z.boolean(),
    origin: originSchema.optional(),
  })
  .strict();
export const checkpointSchema = z.object({
  id: idSchema,
  createdAt: z.number(),
  entryCount: z.number(),
});
export const shareSummarySchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  ownerName: z.string(),
  title: z.string(),
  provider: z.string(),
  status: z.string(),
  updatedAt: z.number(),
  online: z.boolean(),
  origin: originSchema.optional(),
});
export const shareDetailSchema = shareSummarySchema.extend({
  entries: transcriptSchema,
  checkpoints: z.array(checkpointSchema),
});
export const memberSchema = z.object({
  id: idSchema,
  name: z.string(),
  role: z.enum(["admin", "member"]),
});
export const identitySchema = memberSchema.extend({
  teamId: idSchema,
  teamName: z.string(),
  protocol: z.literal(PROTOCOL_VERSION),
});
export const sessionSchema = z.object({
  token: z.string(),
  identity: identitySchema,
});
export const forkSnapshotSchema = z.object({
  id: idSchema,
  origin: originSchema,
  entries: transcriptSchema,
});
export type Entry = z.infer<typeof entrySchema>;
export type Publish = z.infer<typeof publishSchema>;
export type Identity = z.infer<typeof identitySchema>;
export type ForkSnapshot = z.infer<typeof forkSnapshotSchema>;
export type ShareDetail = z.infer<typeof shareDetailSchema>;
