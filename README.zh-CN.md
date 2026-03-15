# cli-run-ui

Claude Code 和 Codex 的本地 Agent 工作台。

[English README](./README.md)

## 项目定位

`cli-run-ui` 把本地 Claude Code / Codex 的运行过程收拢到一个浏览器工作台里。它不是单纯的 transcript 浏览器，而是把下面几类能力放到了一起：

- 会话与 transcript 浏览
- headless task / run 执行
- 真实 PTY 交互式终端
- 浏览器内直接发消息给 agent
- 多 Agent relay room
- 面向 GitHub 的任务闭环

整个项目偏向本地优先：

- 直接跑在你已有的代码仓库上
- 默认只监听 `127.0.0.1`
- 复用本机已经安装好的 `codex` / `claude`
- 服务重启后保留最近的运行历史

## 当前已实现能力

### 工作台界面

- 聚合 Claude Code 和 Codex 的本地会话
- 通过 SSE 实时刷新 session / conversation
- 支持中英文界面切换
- 支持多套主题色
- 支持对话消息、工具输入、工具输出一键复制

### 运行方式

- `Headless run`：适合一次性实现、审查、总结类任务
- `Interactive terminal`：基于真实 PTY，更接近 `claude-run` 风格
- 浏览器聊天框：可直接把消息发送到当前 terminal，没有 terminal 时也可自动拉起

### 多 Agent 协作

- Claude / Codex relay room
- 内置房间模板
- 浏览器本地保存自定义 relay 模板
- relay 过程中支持人工插话
- 支持长期生效的 pinned rules
- 支持导出 relay transcript

### GitHub 任务闭环

- 为任务创建独立分支
- 可从 GitHub issue URL 导入任务草稿
- 把任务分配给 Claude 或 Codex 后台执行
- 查看 diff 摘要、改动文件、测试输出、agent 日志
- 在 UI 中一键创建 PR
- 在 UI 中 approve / request changes / merge
- 展示 PR reviews、PR comments、check runs、branch protection 和 merge readiness

## 快速开始

### 环境要求

- Node.js 20+
- 通过 Corepack 使用 `pnpm`
- `git`
- 本机已安装 `codex` 和/或 `claude`，或者通过环境变量显式指定路径

### 一条命令本地启动

```bash
corepack pnpm local
```

这个命令会先安装依赖，再启动整个 monorepo 的开发环境。

如果依赖已经装好，也可以直接用：

```bash
corepack pnpm dev
```

默认地址：

- Web：`http://127.0.0.1:5173`
- Server：`http://127.0.0.1:4000`

## 远程访问

你可以把 UI 指向远程 cli-run-ui 服务，用手机或其他电脑访问。

1. 在主机上启动服务并绑定外网地址，可选加 Token：

```bash
CLI_RUN_UI_HOST=0.0.0.0
CLI_RUN_UI_ALLOWED_ORIGINS=https://your-ui-host
CLI_RUN_UI_TOKEN=your_shared_token
PORT=4000
```

2. 在浏览器 UI 的「远程连接」面板填写：

- API 地址：`https://your-host:4000`
- Token：与 `CLI_RUN_UI_TOKEN` 一致

留空表示使用本地代理（开发环境会通过 Vite 转发）。如需在构建时预置默认地址，设置 `VITE_API_BASE`。

## 推荐使用路径

### 1. 浏览已有会话

打开工作台后，可以先查看本地 Claude / Codex transcript、token 使用量和项目活跃度。

### 2. 发起运行

你可以根据场景选择：

- `Headless run`：适合单次任务
- `Interactive terminal`：适合真实 CLI 会话

### 3. 在浏览器里直接和 Agent 对话

通过浏览器聊天框，可以把指令直接发给当前 terminal 中的 agent。

### 4. 走完整任务闭环

任务面板支持下面这条链路：

1. 创建任务分支
2. 可选导入 GitHub issue
3. 分配给 Claude 或 Codex
4. 查看日志、diff、测试、checks、PR 活动
5. 创建 PR
6. 审批、打回、合并

## GitHub 集成说明

GitHub 相关操作通过 GitHub REST API 完成。

如果要启用一键创建 PR / review / merge，请设置：

```bash
CLI_RUN_UI_GITHUB_TOKEN=your_token_here
```

或者：

```bash
GITHUB_TOKEN=your_token_here
```

需要注意：

- 仓库的 `origin` 必须指向 GitHub
- 如果当前工作区本身是 dirty 的，任务创建会被拦住，避免把本地未提交改动混进 agent 任务
- merge readiness 会综合 PR 状态、review、checks 和 branch protection 来判断
- merge 后删除远端分支默认关闭，需要单独开启

## 配置项

### CLI 覆盖

当 `codex` 或 `claude` 不在默认 `PATH` 里时，可以设置：

```bash
CLI_RUN_UI_CODEX_COMMAND=codex
CLI_RUN_UI_CLAUDE_COMMAND=claude
```

这两个值也可以直接写成可执行文件的绝对路径。

### 运行历史存储

```bash
CLI_RUN_UI_DATA_DIR=.cli-run-ui
CLI_RUN_UI_HISTORY_FILE=.cli-run-ui/runtime-history.json
```

- `CLI_RUN_UI_DATA_DIR`：设置运行时数据目录
- `CLI_RUN_UI_HISTORY_FILE`：显式指定历史文件路径

### 服务端 / 访问控制

```bash
PORT=4000
CLI_RUN_UI_TOKEN=optional_shared_token
```

- `PORT`：修改服务端端口
- `CLI_RUN_UI_TOKEN`：为 API 增加一个简单的 bearer token 保护

### GitHub 高级配置

```bash
CLI_RUN_UI_GITHUB_API_BASE_URL=https://api.github.com
CLI_RUN_UI_DELETE_REMOTE_BRANCH_ON_MERGE=1
```

- `CLI_RUN_UI_GITHUB_API_BASE_URL`：适用于 GitHub Enterprise
- `CLI_RUN_UI_DELETE_REMOTE_BRANCH_ON_MERGE=1`：合并后尝试删除远端分支

## 持久化行为

服务重启后，会恢复最近的运行历史，包括：

- runs
- terminal sessions
- task 元数据
- relay 元数据
- 最近输出摘录

但它不会重新接管旧进程。如果服务重启时某个 run 或 terminal 仍在运行，恢复后会被安全地标记成 stopped / closed。

## 安全提示

- 服务默认只绑定到 `127.0.0.1`
- 日志、transcript、prompt、diff 里都可能包含敏感代码或业务信息
- 如果没有额外访问控制，不要把开发端口暴露给不可信网络

## Monorepo 结构

- `apps/web`：Vite + React 前端
- `apps/server`：本地编排服务
- `packages/core`：共享 DTO、解析器、provider 逻辑

## 后续重点

当前更推荐的下一阶段是：

1. 自动化和连接器
2. 团队能力，例如共享、权限、审计和成本可见性
