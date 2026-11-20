import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Connector } from "./plugin/server/connector";
import * as rpc from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  const connector = new Connector();
  server.handle(rpc.statusRpc, (_input, { paseo }) => {
    connector.bind(paseo);
    return connector.status();
  });
  server.handle(rpc.connectRpc, (input, { paseo }) => {
    connector.bind(paseo);
    return connector.connect(input);
  });
  server.handle(rpc.localRpc, (_input, { paseo }) => {
    connector.bind(paseo);
    return connector.local();
  });
  server.handle(rpc.shareRpc, (input, { paseo }) => {
    connector.bind(paseo);
    return connector.share(input.agentId, input.enabled);
  });
  server.handle(rpc.forkRpc, (input, { paseo }) => {
    connector.bind(paseo);
    return connector.fork(input);
  });
  server.handle(rpc.listRpc, () => connector.list());
  server.handle(rpc.detailRpc, (input) => connector.detail(input.shareId));
  server.handle(rpc.inviteRpc, () => connector.invite());
  server.handle(rpc.membersRpc, () => connector.members());
  server.handle(rpc.removeMemberRpc, (input) =>
    connector.removeMember(input.memberId),
  );
  server.handle(rpc.disconnectRpc, () => connector.disconnect());
  // The SDK's legacy hook registrations are shared by stable 0.15 and beta 0.16.
  // COMPAT(hook-names): remove when the supported floor includes addHook in every release.
  server.on("agent.turn_started", async (_event, { paseo }) => {
    connector.bind(paseo);
  });
  server.on("agent.turn_ended", async (_event, { paseo }) => {
    connector.bind(paseo);
    await connector.tick();
  });
  return () => connector.stop();
}
