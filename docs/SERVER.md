# 部署团队服务


需要 Node.js 22.13 或更新版本。服务使用 Node 自带 SQLite，首次启动时创建数据库。

```bash
npm ci
npm run build
export TEAM_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
export TEAM_DB=/absolute/path/to/private-data/team.db
npm start
```

使用解压后的发布包时，设置相同的环境变量，直接运行 `node /absolute/path/to/package/dist/team-service.mjs`，省略 `npm ci` 和构建步骤。

默认监听 `127.0.0.1:8787`。服务管理员保管 `TEAM_BOOTSTRAP_TOKEN`，用于创建团队；成员加入使用一次性邀请口令。创建密钥只用于创建请求，不写入插件状态。

服务地址由 daemon 主机访问。本部署使用 `http://47.94.77.187:18787`。插件也接受 localhost 上的 HTTP 地址，其他远程服务地址需要 HTTPS。使用容器可执行：

```bash
docker compose up --build -d
```

先在环境中设置 `TEAM_BOOTSTRAP_TOKEN`。Compose 只把端口发布到宿主机 loopback，反向代理连接该端口；数据库使用独立卷。此命令只编译团队服务，不编译 Paseo。
