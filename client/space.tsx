import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import * as rpc from "../shared/rpc";
import { Button, ErrorText } from "./components";
import { Connect } from "./connect";
import { Conversation } from "./conversation";

export function TeamSpace(props: PluginScreenProps) {
  const { theme, layout } = props;
  const [tab, setTab] = useState<"team" | "local" | "members">("team");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const cache = useQueryClient();
  const getStatus = useRpc(rpc.statusRpc);
  const list = useRpc(rpc.listRpc);
  const local = useRpc(rpc.localRpc);
  const share = useRpc(rpc.shareRpc);
  const invite = useRpc(rpc.inviteRpc);
  const members = useRpc(rpc.membersRpc);
  const removeMember = useRpc(rpc.removeMemberRpc);
  const disconnect = useRpc(rpc.disconnectRpc);
  const status = useQuery({
    queryKey: ["team-space", "status"],
    queryFn: () => getStatus({}),
    refetchInterval: 3_000,
    retry: false,
  });
  const identity = status.data?.identity;
  const team = useQuery({
    queryKey: ["team-space", "list", identity?.teamId],
    queryFn: () => list({}),
    enabled: !!identity && tab === "team",
    refetchInterval: 3_000,
    retry: false,
  });
  const own = useQuery({
    queryKey: ["team-space", "local"],
    queryFn: () => local({}),
    enabled: !!identity && tab === "local",
    refetchInterval: 5_000,
  });
  const people = useQuery({
    queryKey: ["team-space", "members", identity?.teamId],
    queryFn: () => members({}),
    enabled: !!identity && tab === "members",
    refetchInterval: 10_000,
    retry: false,
  });
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["team-space"] });
  };
  const sharing = useMutation({ mutationFn: share, onSettled: refresh });
  const invitation = useMutation({ mutationFn: () => invite({}) });
  const removing = useMutation({
    mutationFn: removeMember,
    onSuccess: async () => {
      setConfirmRemove(null);
      await refresh();
    },
  });
  const leaving = useMutation({
    mutationFn: () => disconnect({}),
    onSuccess: () => {
      setSelected(null);
      cache.removeQueries({ queryKey: ["team-space"] });
    },
  });
  if (status.error)
    return (
      <View style={{ padding: 20, gap: 12 }}>
        <ErrorText theme={theme} error={status.error} />
        <Button theme={theme} onPress={() => void status.refetch()}>
          重试
        </Button>
      </View>
    );
  if (!status.data)
    return (
      <Text style={{ color: theme.colors.foregroundMuted, padding: 20 }}>
        正在读取团队设置…
      </Text>
    );
  if (!identity) return <Connect theme={theme} />;
  if (selected)
    return (
      <Conversation
        key={selected}
        {...props}
        shareId={selected}
        identity={identity}
        back={() => setSelected(null)}
      />
    );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 16 : 24, gap: 18 }}
    >
      <View style={{ gap: 6 }}>
        <Text
          style={{
            color: theme.colors.foreground,
            fontSize: 26,
            fontWeight: "700",
          }}
        >
          {identity.teamName}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>
          以 {identity.name} 的身份加入 · 共享进度，独立继续对话
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button
          theme={theme}
          primary={tab === "team"}
          onPress={() => setTab("team")}
        >
          团队 Agent
        </Button>
        <Button
          theme={theme}
          primary={tab === "local"}
          onPress={() => setTab("local")}
        >
          我的 Agent
        </Button>
        <Button
          theme={theme}
          primary={tab === "members"}
          onPress={() => setTab("members")}
        >
          成员与设置
        </Button>
      </View>
      <ErrorText theme={theme} error={status.data.error} />
      {tab === "team" && (
        <>
          <ErrorText theme={theme} error={team.error} />
          {!team.error && !team.data?.length && (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {team.isPending
                ? "正在同步…"
                : "团队里还没有 agent。到“我的 Agent”选择一个加入。"}
            </Text>
          )}
          {!team.error &&
            team.data?.map((agent) => (
              <View
                key={agent.id}
                style={{
                  backgroundColor: theme.colors.surface1,
                  padding: 16,
                  borderRadius: 10,
                  gap: 10,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.foreground,
                    fontSize: 17,
                    fontWeight: "600",
                  }}
                >
                  {agent.title}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted }}>
                  {agent.ownerName} · {agent.online ? agent.status : "离线"} ·{" "}
                  {agent.provider}
                </Text>
                {agent.origin && (
                  <Text
                    style={{
                      color: theme.colors.foregroundMuted,
                      fontSize: 12,
                    }}
                  >
                    来自 {agent.origin.ownerName} 的分支
                  </Text>
                )}
                <View style={{ flexDirection: "row" }}>
                  <Button theme={theme} onPress={() => setSelected(agent.id)}>
                    查看对话与分支
                  </Button>
                </View>
              </View>
            ))}
        </>
      )}
      {tab === "local" && (
        <>
          <Text style={{ color: theme.colors.foregroundMuted, lineHeight: 21 }}>
            加入后，当前可读取的文字历史与后续进度会同步给全体成员。移出后停止共享；他人已创建的分支仍然保留。
          </Text>
          <ErrorText theme={theme} error={own.error || sharing.error} />
          {!own.data?.length && (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              本机暂时没有可共享的 agent。
            </Text>
          )}
          {own.data?.map((agent) => {
            const shared = status.data.shared.find(
              (item) => item.agentId === agent.id,
            );
            return (
              <View
                key={agent.id}
                style={{
                  backgroundColor: theme.colors.surface1,
                  padding: 16,
                  borderRadius: 10,
                  gap: 10,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.foreground,
                    fontSize: 16,
                    fontWeight: "600",
                  }}
                >
                  {agent.title}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted }}>
                  {agent.provider} · {agent.status} ·{" "}
                  {shared
                    ? shared.pendingDelete
                      ? "正在撤回共享"
                      : "团队可见"
                    : "仅自己可见"}
                </Text>
                <ErrorText theme={theme} error={shared?.error} />
                <View
                  style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
                >
                  <Button
                    theme={theme}
                    primary={!shared}
                    disabled={sharing.isPending || shared?.pendingDelete}
                    onPress={() =>
                      sharing.mutate({ agentId: agent.id, enabled: !shared })
                    }
                  >
                    {shared ? "移出团队" : "加入团队"}
                  </Button>
                  {props.navigation && (
                    <Button
                      theme={theme}
                      onPress={() =>
                        props.navigation?.openAgent({ agentId: agent.id })
                      }
                    >
                      打开我的会话
                    </Button>
                  )}
                </View>
              </View>
            );
          })}
          {sharing.data?.pending && (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              同步已停止。服务恢复连接后会撤销团队访问，当前服务器副本可能仍然可见。
            </Text>
          )}
        </>
      )}
      {tab === "members" && (
        <>
          <ErrorText
            theme={theme}
            error={
              people.error ||
              invitation.error ||
              removing.error ||
              leaving.error
            }
          />
          {!people.error &&
            people.data?.map((person) => (
              <View key={person.id} style={{ gap: 8, paddingVertical: 8 }}>
                <Text style={{ color: theme.colors.foreground }}>
                  {person.name} ·{" "}
                  {person.role === "admin" ? "团队管理员" : "成员"}
                </Text>
                {identity.role === "admin" && person.id !== identity.id && (
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    <Button
                      theme={theme}
                      disabled={removing.isPending}
                      onPress={() =>
                        confirmRemove === person.id
                          ? removing.mutate({ memberId: person.id })
                          : setConfirmRemove(person.id)
                      }
                    >
                      {confirmRemove === person.id
                        ? "确认移除并撤销其共享"
                        : "移除成员"}
                    </Button>
                    {confirmRemove === person.id && (
                      <Button
                        theme={theme}
                        onPress={() => setConfirmRemove(null)}
                      >
                        取消
                      </Button>
                    )}
                  </View>
                )}
              </View>
            ))}
          {identity.role === "admin" && (
            <Button
              theme={theme}
              disabled={invitation.isPending}
              onPress={() => invitation.mutate()}
            >
              生成一次性邀请口令
            </Button>
          )}
          {invitation.data && (
            <View style={{ gap: 6 }}>
              <Text selectable style={{ color: theme.colors.foreground }}>
                {invitation.data.code}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted }}>
                有效至 {new Date(invitation.data.expiresAt).toLocaleString()}
                ，使用一次后失效。
              </Text>
            </View>
          )}
          <Text selectable style={{ color: theme.colors.foregroundMuted }}>
            {status.data.url}
          </Text>
          <Button
            theme={theme}
            disabled={leaving.isPending}
            onPress={() => leaving.mutate()}
          >
            撤回我的共享并断开本机连接
          </Button>
        </>
      )}
    </ScrollView>
  );
}
