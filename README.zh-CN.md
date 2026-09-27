# ChatGPT Web

这个项目在保留的 ChatGPT 网页上运行任务。第 7 版提供独立的 **ChatGPT Web API v1**：调用者用 `previous_response_id` 明确指定继续哪个会话，只发送新增消息，并负责执行自己的工具。服务端保留原网页和请求回执。

它不再是 Codex/OpenAI 兼容模型端点，不再根据完整历史或 Codex 元数据猜测对应网页，也不提供原生模型转发和 Astra Jev 路由。

[英文说明](README.md) · [完整协议契约](docs/protocol.md) · [架构](docs/rewrite.md) · [验证范围](docs/verification.md)

## 启动

使用 `package.json` 固定的 Bun 版本：

```sh
bun install --frozen-lockfile
(cd desktop && bun install --frozen-lockfile)
bun run bend:setup
bun run bend:build
bun run setup
bun run app
```

在桌面应用内打开 ChatGPT 并登录。默认 API 地址是 `http://127.0.0.1:8787`，本地授权 token 在所选 `--home` 下的 `application.json` 中。开发时使用 `bun run dev:app`，它使用当前 worktree 的独立配置与浏览器资料。

## 请求方式

每个逻辑请求必须有独立的 `Idempotency-Key`。同一个请求重试时沿用原 key 和原请求体，可以改变 `stream`；同 key 改内容会被拒绝。

首次请求：

```json
{"model":"chatgpt-web/medium","input":"解释这个设计。","stream":true}
```

得到最终回答后，保存响应的 `id`，下一次使用新 key，只提交新增内容：

```json
{"previous_response_id":"<上一次响应的 id>","input":"再比较一下另一种方案。","stream":true}
```

续接请求继承首次请求的模型、指令、工具和输出格式，不重新提交这些设置，也不上传旧历史。一个响应只能有一个后继；需要分支、改变设置或换成摘要上下文时，明确创建新的根请求。`bun runtime/cli.ts chat` 是已经按这个协议实现的简单交互客户端。

所有 `/v1/*` 接口都要求 `Authorization: Bearer <本地 token>`。`GET /v1/schema` 返回请求与响应的 JSON Schema。字段、错误码、重试、流式事件及迁移规则以[完整协议](docs/protocol.md)为准。

## 工具和流式返回

使用工具时，在配置中启用 `full` 模式，并通过桌面 MCP 页面连接 **ChatGPT Web Tools**。调用者在首次请求中声明工具名称和参数结构。网页通过 `web_tool_list`、`web_tool_call` 请求调用；API 返回 `requires_action` 后，调用者自行执行工具，再用该响应的 ID 一次性交回完整结果批次。

工具结果交回原网页正在等待的工具调用，不会再次点击发送。服务端不推断 Codex 内部工具，也不把普通命令翻译成某个特定运行时的工具。

`stream:true` 返回 SSE。生成中的文本以完整、可替换的临时快照返回，最后返回已提交的响应。调用者应替换临时文本，而不是把每次快照都追加进去。断开连接不代表停止任务，也不会触发重发。

## 恢复与升级

请求、前驱占用、网页归属和待执行操作在同一事务中登记。最终回答与允许下一次续接的凭据也一起提交。原网页丢失、被手工修改或前驱已被其他请求占用时，接口明确报错，不偷偷新建替代页面。

重启只恢复持久化状态，不重发任务。检查原网页后，用 `/v1/responses/{id}/resume` 恢复观察；只有显式 `/cancel` 才请求停止对应网页任务。

从第 6 版升级时，先停止旧服务，再执行：

```sh
bun runtime/cli.ts migrate --home <原有配置目录>
```

迁移保留数据库、日志和浏览器资料，为修改的配置创建备份，删除旧转发、Jev 和自动历史管理设置，不发送消息。旧 API 响应 ID 不会自动转换成新协议的会话标识。调用者需要明确提供上下文建立新根请求；旧操作仍可查看和显式取消，但不能按新协议恢复执行。

包名、默认资料目录名和桌面应用标识保留旧值，避免升级时意外切换浏览器资料；这不表示仍提供 Codex API 兼容。

## 验证

`bun run verify` 执行 Bend 证明检查、真实实现的变异检查、原生编译、类型检查、SQLite/HTTP/MCP 边界测试、真实 Electron 本地网页测试，以及独立运行包的构建和迁移启动检查。自动测试不使用真实 ChatGPT 账户发送消息。证明覆盖纯决策，操作系统、SQLite 和网页观察仍是明确列出的外部边界。
