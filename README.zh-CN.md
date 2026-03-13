# cli-run-ui

Claude Code 与 Codex 的本地运行工作台。

[English README](./README.md)

## 功能特性
- 将本地 Claude 与 Codex transcript 聚合到同一个 dashboard
- 通过 SSE 实时推送 session 与 conversation 更新
- 支持发起 `codex exec` 与 `claude --print` 的 headless run
- 支持 Claude/Codex 的 PTY 交互式终端，并支持 resume 模式
- 展示最近的 run、terminal、token 使用量与项目级活动
- 服务端重启后仍能保留最近的 run / terminal 历史
- 浏览器会本地记住 agent workspace 的草稿状态

## 快速开始
```bash
corepack pnpm local
```

Web 端默认运行在 `http://127.0.0.1:5173`，Server 默认运行在 `http://127.0.0.1:4000`。

如果依赖已经安装好了，直接运行 `corepack pnpm dev` 也可以。

## CLI 覆盖配置
如果 `codex` 或 `claude` 不在默认 `PATH` 中，可以设置下面的环境变量：

```bash
CLI_RUN_UI_CODEX_COMMAND=codex
CLI_RUN_UI_CLAUDE_COMMAND=claude
CLI_RUN_UI_DATA_DIR=.cli-run-ui
```

这些值也可以直接填写可执行文件的绝对路径。
如果你希望指定一个明确的历史文件路径，而不是目录，可以设置 `CLI_RUN_UI_HISTORY_FILE`。

## 当前交互模型
- `Headless run` 适合一次性执行实现、评审、总结这类任务。
- `Interactive terminal` 使用真实 PTY，更接近 `claude-run` 风格的工作流。
- 从 UI 启动 terminal 时，prompt 输入框里的内容可以在 CLI 启动后自动发送。

## 运行历史
- 默认情况下，运行历史会写入当前工作目录下的 `.cli-run-ui/runtime-history.json`。
- 持久化的是最近的 run / terminal 记录与输出摘要，不会重新附着到旧进程。
- 如果服务重启时某个 run 或 terminal 仍处于运行中，恢复后会被安全标记为已停止或已关闭。

## 注意事项
- Server 仅绑定到 `127.0.0.1`。
- 日志与 transcript 可能包含敏感信息，请不要随意暴露端口。
