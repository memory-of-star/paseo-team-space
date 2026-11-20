import {
  useRpc,
  type PluginClientContext,
  type PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { SidebarRow } from "@getpaseo/client/ui";
import { TeamSpace } from "./client/space";
import { shareRpc, statusRpc } from "./shared/rpc";

function TeamEntry({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const status = useRpc(statusRpc);
  useQuery({ queryKey: ["team-space", "status"], queryFn: () => status({}) });
  return (
    <SidebarRow
      icon="Users"
      active={currentScreen?.screenId === "team"}
      onPress={() => openScreen({ screenId: "team" })}
    />
  );
}
export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "team", title: "团队空间", Component: TeamSpace });
  client.addSidebarHeaderItem({
    id: "team",
    title: "团队空间",
    Component: TeamEntry,
  });
  client.addCommandCenterItem({
    id: "share",
    title: "将此 agent 加入团队",
    context: "agent",
    icon: "Users",
    async onSelect({ agent, rpc, openScreen }) {
      await rpc(shareRpc, { agentId: agent.id, enabled: true });
      openScreen({ screenId: "team" });
    },
  });
  client.addCommandCenterItem({
    id: "unshare",
    title: "将此 agent 移出团队",
    context: "agent",
    icon: "UserMinus",
    async onSelect({ agent, rpc, openScreen }) {
      await rpc(shareRpc, { agentId: agent.id, enabled: false });
      openScreen({ screenId: "team" });
    },
  });
  return () => {};
}
