import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { connectRpc } from "../../shared/rpc";
import { Button, ErrorText, Field } from "./components";

export function Connect({ theme }: { theme: PluginTheme }) {
  const cache = useQueryClient();
  const connect = useRpc(connectRpc);
  const [create, setCreate] = useState(false);
  const [url, setUrl] = useState("http://127.0.0.1:8787");
  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [secret, setSecret] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      connect(
        create
          ? { kind: "create", url, name, teamName, bootstrapToken: secret }
          : { kind: "join", url, name, code: secret },
      ),
    onSuccess: async () => {
      setSecret("");
      await cache.invalidateQueries({ queryKey: ["team-space"] });
    },
  });
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 24,
        gap: 20,
        maxWidth: 620,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <Text
        style={{
          color: theme.colors.foreground,
          fontSize: 26,
          fontWeight: "700",
        }}
      >
        团队空间
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, lineHeight: 22 }}>
        一起看进度，从已有上下文展开自己的对话。只有你主动加入团队的 agent
        才会被共享。
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          theme={theme}
          primary={!create}
          onPress={() => {
            setCreate(false);
            setSecret("");
          }}
        >
          加入团队
        </Button>
        <Button
          theme={theme}
          primary={create}
          onPress={() => {
            setCreate(true);
            setSecret("");
          }}
        >
          创建团队
        </Button>
      </View>
      <Field
        theme={theme}
        label="团队服务地址（从运行 daemon 的机器访问）"
        value={url}
        onChange={setUrl}
      />
      <Field theme={theme} label="你的名字" value={name} onChange={setName} />
      {create && (
        <Field
          theme={theme}
          label="团队名称"
          value={teamName}
          onChange={setTeamName}
        />
      )}
      <Field
        theme={theme}
        label={create ? "服务管理员提供的创建密钥" : "团队邀请口令（一次有效）"}
        value={secret}
        onChange={setSecret}
        secret
      />
      <ErrorText theme={theme} error={mutation.error} />
      <Button
        theme={theme}
        primary
        disabled={
          mutation.isPending ||
          !name.trim() ||
          !secret.trim() ||
          (create && !teamName.trim())
        }
        onPress={() => mutation.mutate()}
      >
        {mutation.isPending ? "正在连接…" : create ? "创建团队" : "加入团队"}
      </Button>
    </ScrollView>
  );
}
