import type { PluginHandlerContext } from "@getpaseo/plugin/server";

// Derive SDK types through the host-provided plugin module. Direct imports from
// @getpaseo/client or /protocol make Paseo's compiler require local npm packages,
// even for type-only imports in an otherwise standalone plugin archive.
export type PaseoApi = PluginHandlerContext["paseo"];
export type PaseoAgentHandle = ReturnType<PaseoApi["agents"]["ref"]>;
export type AgentTimelineItem = Awaited<
  ReturnType<PaseoAgentHandle["timeline"]["refetch"]>
>["entries"][number]["item"];
