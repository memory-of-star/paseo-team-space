import { useRef, useState } from "react";
import { FlatList, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { detailRpc, forkRpc, forkTurnsRpc, forkModelsRpc } from "../shared/rpc";
import type { Identity } from "../shared/model";
import { Button, ErrorText, Field } from "./components";

export function Conversation({
  shareId,
  identity,
  theme,
  navigation,
  back,
}: Pick<PluginScreenProps, "theme" | "navigation"> & {
  shareId: string;
  identity: Identity;
  back(): void;
}) {
  const getDetail = useRpc(detailRpc);
  const fork = useRpc(forkRpc);
  const getTurns = useRpc(forkTurnsRpc);
  const getModels = useRpc(forkModelsRpc);
  const detail = useQuery({
    queryKey: ["team-space", "detail", shareId],
    queryFn: () => getDetail({ shareId }),
    refetchInterval: 2_000,
    retry: false,
  });
  const [showFork, setShowFork] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [startEntry, setStartEntry] = useState<string>();
  const [page, setPage] = useState(0);
  const requestKey = useRef<string | null>(null);
  const data = detail.data;
  const checkpointId = selected ?? data?.checkpoints[0]?.id;
  const turns = useQuery({
    queryKey: ["team-space", "fork-turns", shareId, checkpointId],
    enabled: showFork && !!checkpointId,
    queryFn: () => getTurns({ shareId, checkpointId: checkpointId! }),
    staleTime: Infinity,
    retry: false,
  });
  const providerName = (provider ?? data?.provider ?? "").trim();
  const models = useQuery({
    queryKey: ["team-space", "fork-models", providerName],
    enabled: showFork && !!providerName && !providerName.includes("/"),
    queryFn: () => getModels({ provider: providerName }),
    retry: false,
  });
  const chosenModel =
    model || (models.data?.length === 1 ? models.data[0].id : "");
  const selection = providerName.includes("/")
    ? providerName
    : chosenModel && `${providerName}/${chosenModel}`;
  const mutate = useMutation({
    mutationFn: async () => {
      if (!checkpointId) throw new Error("等待一个完整轮次后再创建分支");
      requestKey.current ??= `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return fork({
        shareId,
        checkpointId,
        provider: selection,
        startEntryId: startEntry,
        requestKey: requestKey.current,
      });
    },
    onSuccess: (result) => {
      requestKey.current = null;
      navigation?.openAgent({ agentId: result.agentId });
    },
  });
  // Do not display stale cached conversation after withdrawal or revoked membership.
  if (detail.error)
    return (
      <View style={{ padding: 20, gap: 12 }}>
        <Button theme={theme} onPress={back}>
          返回团队
        </Button>
        <ErrorText theme={theme} error={detail.error} />
      </View>
    );
  if (!data)
    return (
      <Text style={{ color: theme.colors.foregroundMuted, padding: 20 }}>
        正在读取共享会话…
      </Text>
    );
  return (
    <View style={{ flex: 1, gap: 12, padding: 16 }}>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <Button theme={theme} onPress={back}>
          返回团队
        </Button>
        <View style={{ flex: 1, minWidth: 150, gap: 3 }}>
          <Text
            style={{
              color: theme.colors.foreground,
              fontSize: 18,
              fontWeight: "600",
            }}
          >
            {data.title}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {data.ownerName} ·{" "}
            {data.online ? data.status : "离线，显示最后同步"} ·{" "}
            {identity.id === data.ownerId ? "你的共享会话" : "只读"}
          </Text>
        </View>
        <Button
          theme={theme}
          primary
          disabled={!data.checkpoints.length}
          onPress={() => {
            if (!showFork) {
              setSelected(data.checkpoints[0]?.id ?? null);
              setStartEntry(undefined);
              setPage(0);
              requestKey.current = null;
            }
            setShowFork(!showFork);
          }}
        >
          从历史创建分支
        </Button>
      </View>
      {data.origin && (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          分支来源：{data.origin.ownerName} / {data.origin.title}
        </Text>
      )}
      {showFork ? (
        <ScrollView contentContainerStyle={{ gap: 14, padding: 4 }}>
          <Text style={{ color: theme.colors.foregroundMuted, lineHeight: 21 }}>
            分支默认私有，在你的机器上使用你选择的 provider
            运行。会继承可见的文字历史，不会复制对方的文件、工具环境或原生会话状态。
          </Text>
          <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>
            选择已完成轮次的快照
          </Text>
          {data.checkpoints.map((cp) => (
            <Button
              key={cp.id}
              theme={theme}
              primary={checkpointId === cp.id}
              disabled={mutate.isPending}
              onPress={() => {
                setSelected(cp.id);
                setStartEntry(undefined);
                setPage(0);
                requestKey.current = null;
              }}
            >
              {new Date(cp.createdAt).toLocaleString()} · {cp.entryCount} 条记录
            </Button>
          ))}
          <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>
            从哪一轮开始？包含该轮到所选快照末尾的对话
          </Text>
          <Button
            theme={theme}
            primary={!startEntry}
            onPress={() => {
              setStartEntry(undefined);
              requestKey.current = null;
            }}
          >
            全部历史
          </Button>
          <ErrorText theme={theme} error={turns.error} />
          {turns.isLoading && (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              正在读取快照…
            </Text>
          )}
          {turns.data?.slice(page * 12, (page + 1) * 12).map((turn, index) => (
            <Button
              key={turn.id}
              theme={theme}
              primary={startEntry === turn.id}
              onPress={() => {
                setStartEntry(turn.id);
                requestKey.current = null;
              }}
            >
              第 {page * 12 + index + 1} 轮 · {turn.preview}
            </Button>
          ))}
          {page > 0 && (
            <Button theme={theme} onPress={() => setPage(page - 1)}>
              上一页轮次
            </Button>
          )}
          {(turns.data?.length ?? 0) > (page + 1) * 12 && (
            <Button theme={theme} onPress={() => setPage(page + 1)}>
              下一页轮次
            </Button>
          )}
          <Field
            theme={theme}
            label="本机 provider 或 provider/model ID"
            value={provider ?? data.provider}
            onChange={(value) => {
              setProvider(value);
              setModel("");
              requestKey.current = null;
            }}
          />
          {!providerName.includes("/") && (
            <>
              <Text style={{ color: theme.colors.foreground }}>
                选择本机模型
              </Text>
              <ErrorText theme={theme} error={models.error} />
              {models.data?.map((item) => (
                <Button
                  key={item.id}
                  theme={theme}
                  primary={chosenModel === item.id}
                  onPress={() => {
                    setModel(item.id);
                    requestKey.current = null;
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </>
          )}
          <ErrorText theme={theme} error={mutate.error} />
          {mutate.data && (
            <Text selectable style={{ color: theme.colors.foreground }}>
              分支已创建：{mutate.data.agentId}
            </Text>
          )}
          <Button
            theme={theme}
            primary
            disabled={mutate.isPending || !selection || !turns.isSuccess}
            onPress={() => mutate.mutate()}
          >
            {mutate.isPending ? "正在创建本地分支…" : "创建并打开我的分支"}
          </Button>
          <Button theme={theme} onPress={() => setShowFork(false)}>
            返回历史
          </Button>
        </ScrollView>
      ) : (
        <FlatList
          data={data.entries}
          keyExtractor={(item) => item.id}
          initialNumToRender={20}
          ListEmptyComponent={
            <Text style={{ color: theme.colors.foregroundMuted }}>
              暂时没有可共享的文字记录。
            </Text>
          }
          renderItem={({ item }) => (
            <View
              style={{
                paddingVertical: 12,
                paddingHorizontal: 14,
                marginBottom: 8,
                borderRadius: 8,
                backgroundColor:
                  item.role === "user"
                    ? theme.colors.surface2
                    : theme.colors.surface1,
                gap: 6,
              }}
            >
              <Text
                style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
              >
                {item.role === "user"
                  ? data.ownerName
                  : item.role === "assistant"
                    ? "Agent"
                    : "状态"}
              </Text>
              <Text
                selectable
                style={{
                  color: theme.colors.foreground,
                  fontSize: 14,
                  lineHeight: 22,
                }}
              >
                {item.text}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}
