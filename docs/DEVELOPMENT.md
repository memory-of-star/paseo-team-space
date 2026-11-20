# 开发与验证

以下命令在仓库根目录执行。


```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

先将上游 https://github.com/getpaseo/paseo 克隆到本仓库旁边的 `../paseo`，并检出冒烟测试基线 `ee6a2bba77dcb2cd11a52d135cbecfcfdc303941`。兼容测试使用两个真实隔离 daemon，以及上游确定性的示例 provider，不消耗真实模型额度，不连接现有 `~/.paseo`：

```bash
npm install --prefix .runtime/stable @getpaseo/cli@0.15.4
npm install --prefix .runtime/beta @getpaseo/cli@0.16.0-beta.1
node scripts/smoke.mjs
```

报告在 `artifacts/smoke-report.json`。测试包含插件服务端加载、客户端 bundle 编译、稳定版到 beta 的共享、分支本地创建、原会话不变、移出与分支保留。`SMOKE_KEEP=1` 保持隔离实例运行以进行浏览器检查，结束时向测试脚本发送 SIGTERM。

保持实例运行时，执行 `npx playwright install chromium` 和 `node scripts/browser-check.mjs` 检查真实 Paseo Web 客户端。已验证桌面浅色、390px 窄屏深色、只读会话无输入框、从界面创建分支及无横向溢出。截图在 `assets/`，浏览器报告在 `artifacts/browser-report.json`。窄屏检查使用浏览器模拟，尚未在 iOS/Android 真机上验证。

发布前用 `npm pack` 生成独立插件包；包中包含服务构建产物。不要携带 `.runtime`、数据库、团队 token 或测试日志。尚未发布到 npm 或 Paseo 公共插件目录。
