# Tutorial Demos — 逐章可运行的配套代码

每个目录对应一章教程，是独立的项目，可以直接 `npm install && npx tsx main.ts` 运行。

## 目录

| 目录 | 章节 | 需要 API Key | 核心演示 |
|------|------|:---:|------|
| `01-hello-llm/` | 第 01 章 | ✅ | 30 行代码调用一次 LLM |
| `02-event-stream/` | 第 02 章 | ✅ | 流式输出，逐 token 显示 |
| `03-multi-turn/` | 第 03 章 | ✅ | 多轮对话，messages 累积 |
| `04-multi-model/` | 第 04 章 | ✅ | 一套代码切换不同厂商 |
| `05-mock-testing/` | 第 05 章 | ❌ | 录播模型，确定性测试 |
| `06-tool-use/` | 第 06 章 | ✅ | 手动完成一次工具调用流程 |
| `07-agent-loop/` | 第 07 章 | ✅ | while 循环自主多步任务 |
| `08-core-tools/` | 第 08 章 | ✅ | 完整 4 工具 Coding Agent |
| `09-session-persistence/` | 第 09 章 | ✅ | JSONL 持久化 + 会话恢复 |
| `10-stateful-agent/` | 第 10 章 | ✅ | abort / steering / 重入保护 |
| `11-session-tree/` | 第 11 章 | ✅ | 分支、fork、回溯、切换 |
| `12-context-management/` | 第 12 章 | ❌ | 上下文窗口管理 + 截断策略 |
| `13-extension-system/` | 第 13 章 | ✅ | 扩展点：权限拦截 + 结果变换 + 事件 |
| `14-polish/` | 第 14 章 | ✅ | 完整 CLI 产品（Banner / 颜色 / 持久化）|
| `15-evaluation/` | 第 15 章 | ❌* | 自动化评测两层体系 |
| `16-system-prompt/` | 第 16 章 | ❌ | 结构化 prompt + 状态栏 + 防注入 |
| `17-harness/` | 第 17 章 | ❌ | 重试 / 验证 / 防死循环 / Proposer-Reviewer |

## 快速开始

```bash
# 进入任意章节目录
cd demos/07-agent-loop

# 安装依赖
npm install

# 运行（设置对应的 API key）
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts

# 或用 OpenAI
OPENAI_API_KEY=sk-xxx npx tsx main.ts
```

## 学习路径

建议按顺序阅读教程文档（`docs/tutorials/`），同时运行对应的 demo 加深理解。

第 05 章（Mock Testing）、第 12 章（Context Management）、第 16 章（System Prompt）和第 17 章（Harness）不需要 API key，适合离线学习。

第 15 章（Evaluation）的逻辑评测层不需要 API key（标注 ❌*），能力评测层可选需要 key。

第 08 章之后的 demo 是功能完整的 Agent — 可以让它读文件、写代码、跑测试。
