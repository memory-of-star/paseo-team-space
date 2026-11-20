import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { identitySchema, originSchema } from "../shared/model";

const stateSchema = z.object({
  version: z.literal(1),
  deviceId: z.string().uuid(),
  url: z.string(),
  token: z.string(),
  identity: identitySchema.nullable(),
  shares: z.array(
    z.object({
      agentId: z.string(),
      shareId: z.string().uuid(),
      pendingDelete: z.boolean(),
    }),
  ),
  forks: z.record(
    z.string(),
    z.object({
      id: z.string().uuid(),
      agentId: z.string().uuid(),
      shareId: z.string(),
      checkpointId: z.string(),
      provider: z.string(),
      question: z.string(),
      done: z.boolean(),
      origin: originSchema.optional(),
    }),
  ),
});
export type LocalState = z.infer<typeof stateSchema>;
export class LocalStorage {
  readonly directory: string;
  constructor(
    directory = process.env.PASEO_TEAM_SPACE_STATE ??
      join(
        process.env.PASEO_HOME ?? join(homedir(), ".paseo"),
        "plugin-data",
        "team-space",
      ),
  ) {
    this.directory = directory;
  }
  async read(): Promise<LocalState> {
    try {
      return stateSchema.parse(
        JSON.parse(await readFile(join(this.directory, "state.json"), "utf8")),
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return {
          version: 1,
          deviceId: randomUUID(),
          url: "",
          token: "",
          identity: null,
          shares: [],
          forks: {},
        };
      throw new Error(
        "Team-space state could not be read; preserve state.json and repair it before reconnecting",
        { cause: error },
      );
    }
  }
  async write(state: LocalState) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = join(this.directory, `state-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(stateSchema.parse(state)), {
      mode: 0o600,
    });
    await rename(temp, join(this.directory, "state.json"));
  }
}
