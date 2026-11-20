# 在当前 Paseo daemon 安装并启用 Team Space

收到这份文档的 agent，请在用户日常使用的 Paseo daemon 主机上执行下面的命令，直到 CLI 确认 `team-space` 已启用并运行。插件来自公开 GitHub 仓库。团队创建密钥和邀请码都用于之后的团队操作。

## 1. 确认目标 daemon

在运行 daemon 的用户账号下执行。以下命令使用当前用户的默认 Paseo home。若用户指定了自定义 home，在下面每条涉及 daemon 的命令后加上 `--home "<实际路径>"`。桌面或手机连接远程 daemon 时，请在远程主机上操作。

```text
paseo --version
paseo status --json
```

以 `paseo status --json` 返回的 `daemonVersion` 判断运行中的 daemon 版本。`paseo --version` 显示 CLI 版本。如果 daemon 未运行，先启动用户已有的实例，再检查状态。Team Space `v0.1.1` 声明的 Paseo 版本范围是 `>=0.15.4 <0.17.0`，已验证 `0.15.4` 和 `0.16.0-beta.1`。如果 daemon 版本满足要求且 CLI 支持 `paseo plugin`，直接进入第 2 步。

### 版本不满足时，先更新到最新稳定版

如果 daemon 版本不满足要求，或旧 CLI 缺少上述命令，请在目标主机上使用原安装方式更新到 Paseo **最新稳定版**。保留已有的 daemon home、配置和会话。对于通过 npm 全局安装的独立 daemon，在原安装账号和 Node.js 环境中执行：

```text
npm install --global @getpaseo/cli@latest
paseo daemon restart
paseo status --json
```

如果 daemon 由桌面应用或系统服务管理，请更新该应用或服务实际使用的 Paseo，再通过原管理方式重启同一实例。重启后重新读取 `daemonVersion`。如果仍是旧版本，检查服务启动命令指向的 Paseo 路径。确认运行版本满足要求后继续安装；如果最新稳定版已超出上述范围，请报告实际版本和插件要求，等待兼容的插件版本。

## 2. 打开插件总开关，安装固定版本

```text
paseo daemon config set pluginsEnabled true
paseo reload
paseo plugin ls --json
```

查看插件列表。如果还没有 `team-space`，从 GitHub 安装发布标签 `v0.1.1`：

```text
paseo plugin install https://github.com/memory-of-star/paseo-team-space.git --ref v0.1.1
```

如果列表中已有来自本仓库或其本地检出的 `team-space`，可以直接继续启用。若同名条目指向其他项目，先报告来源冲突，并保留现有安装。

## 3. 启用并核验

先查看插件状态。Paseo 通常会在安装成功时自动启用插件。

```text
paseo plugin ls team-space --json
```

如果 `enabled` 为 `false` 或 `status` 为 `"disabled"`，执行以下两条命令。已运行的插件可以直接核验。

```text
paseo plugin enable team-space
paseo plugin ls team-space --json
```

在 JSON 列表中找到 `id` 为 `team-space` 的条目，确认 `enabled` 为 `true`、`status` 为 `"running"`。如果仍在加载，稍后重新查询。如果加载失败，执行 `paseo plugin logs team-space`，根据实际错误处理后重新查询。给用户回报目标 daemon 版本和最终状态。

## 4. 打开团队空间

在连接到该 daemon 的 Paseo 客户端重新打开侧边栏，点击「团队空间」。团队管理员提供一次性邀请码后，成员选择「加入团队」，填写名字、服务地址和邀请码即可。成员可以自行选择要分享的 agent。

本团队的服务地址是 `http://47.94.77.187:18787`。这个公网 HTTP 地址会明文传输邀请码、令牌和共享内容。使用自建团队服务的成员请填写其管理员提供的地址，远程自建服务支持 HTTPS。
