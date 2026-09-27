# Codex Web · Bend

这是把已登录的 ChatGPT 网页作为 Codex 模型后端的本地软件。6.0 是重新设计和实现，不是旧代码外面包一层 Bend：任务状态、工具调用、历史复用、完成判断和可选的推理等级路由使用经过检查的 Bend 实现；TypeScript 负责浏览器、数据库、网络和进程接口。旧 `src/`、`launcher/`、`tests/`、`scripts/` 已删除。

本仓库是从 [`miuuyy/codex-chatgpt-web`](https://github.com/miuuyy/codex-chatgpt-web) 演化出的独立 Bend 重写。后续不会把原仓库的 `main` 合并或 rebase 到本项目；与 ChatGPT DOM、协议、模型能力、安全和可观察行为相关的上游变化会经过审查后按当前架构重新实现。具体约定见 [`UPSTREAM.md`](UPSTREAM.md)。

## 启动

准备 Bun **1.4.0**、Python 3、Node 和 C 编译器，在 macOS 或 Linux 执行：

```sh
bun install --frozen-lockfile
(cd desktop && bun install --frozen-lockfile)
bun run bend:setup
bun run bend:build
bun run app
```

桌面打开后，点击 **Open ChatGPT / sign in**，直接在内嵌浏览器登录。再点击 **Install Codex model profile**，或执行 `bun run install-models`。它只添加单独的配置，不覆盖你的默认模型和其他配置：

```sh
codex --profile web
```

默认是 `browser-only`。需要 Codex 原生工具时，将私有配置 `~/.codex-chatgpt-web/application.json` 的 `mode` 改为 `full`，明确重启服务，并在 ChatGPT 连接同名的 **Codex Native2** MCP 连接器。已安装的 `tunnel-client` 可通过以下命令配置、运行；保持隧道进程运行：

```sh
bun runtime/cli.ts tunnel-connect --key-file /私有目录/运行密钥 --tunnel-id 隧道ID
bun runtime/cli.ts tunnel-run
```

原生工具由外层 Codex 执行，仍然经过 Codex 的审批和沙箱。桥接服务不会直接执行网页给出的 shell 命令。完整配置、CLI-only 用法和可选 Astra Jev 路由见 [英文说明](README.md)。

## 两个最重要的行为

**检测异常不等于网页失败。** 页面看起来出错、没有新内容、读取失败、HTTP 断开或服务崩溃，都不会自动停止、刷新、重新生成或重发任务。一次发送先在数据库中领取不可重复的权限，再点击按钮；领取后丢失回执只表示未知，不能再领一次。

**网页历史就是已经发生的历史，不是每次重放的 API 输入。** 只有原页面、文档身份、完成回答、解释环境和输入前缀都吻合，才会复用页面并追加新内容。用户编辑或分叉历史、手动发送新任务、页面丢失，都不能伪装成原任务的继续。

**Resume observation** 只观察原文档。**Confirm current answer** 是用户明确确认当前回答完成。**Cancel task** 才请求停止，而且不会停止已经被用户另开任务占用的页面。关闭主窗口会隐藏窗口；明确退出会关闭浏览器，尚无结果的任务下次仍保留为未知，不会自动重发。

## 迁移和验证

首次初始化会读取旧配置中可明确继承的安装设置，但不会删除旧配置或发送日志。旧日志的任务身份进入新数据库，继续阻止重复发送。无法辨认的日志必须先人工核对、明确映射；不能靠删除记录绕过。

```sh
bun runtime/cli.ts migrate
bun runtime/cli.ts doctor
bun run dev:app
bun run verify
bun run app:package:dir
```

`dev:app` 使用当前 worktree 的独立测试配置，不占用日常账户目录。`verify` 会真正重新检查证明，而不是信任缓存；同时运行数据库、进程崩溃、HTTP/SSE/MCP 和真实 Electron 本地页面测试，并构建、启动独立运行包。

检查材料位于 `.build/`，运行包位于 `dist/runtime/`，桌面包位于 `desktop/release/`。自动测试不会向真实 ChatGPT 账户发消息，因此不消耗额度；这也意味着不能把本地页面测试说成真实账户界面、其他操作系统或苹果签名公证已经通过。

[设计与保证边界](docs/rewrite.md) · [验证方法](docs/verification.md) · [安全边界](SECURITY.md)
