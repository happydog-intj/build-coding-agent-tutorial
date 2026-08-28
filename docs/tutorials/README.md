---
title: "全部章节目录 — 从零实现 AI Coding Agent"
description: "24 章完整教程目录与简介：从调用 LLM 到实现完整的 AI 编程智能体"
---

# 全部章节目录

> **Coding Agent = LLM + Protocol + Loop + Tools + State**
>
> 本教程共 24 章，分为 5 个阶段，从 30 行调用一次 LLM 到 750 行完整 Coding Agent，逐步拆解 AI 编程智能体的核心原理。

---

## Part 0 · 序章

| # | 章节 | 简介 |
|---|------|------|
| 00 | [观察一次完整的 Agent 运行](./00-observe-full-run) | 在写代码之前先看全貌：一次 "读取文件并总结" 的请求如何走完 LLM 调用 → 工具执行 → 结果返回的完整闭环。建立直觉，理解 Agent 不是魔法，就是一个循环。 |

---

## Part I · 模型与协议

> 核心问题：如何调用 LLM？如何多轮对话？如何适配不同厂商？

| # | 章节 | 简介 |
|---|------|------|
| 01 | [Hello LLM](./01-hello-llm) | 30 行 TypeScript 代码调用 Claude / GPT API 并获取回复。构建 Agent 的第一步——确认你能用代码拿到模型的输出。 |
| 02 | [EventStream 事件流](./02-event-stream) | 实现流式输出，让模型回答逐字显示。理解 Server-Sent Events 协议和逐 token 渲染机制。 |
| 03 | [多轮对话](./03-multi-turn) | 模型为什么不记得上一句话？解答 messages 数组累积、角色区分、上下文传递——多轮对话的本质是"每次都把聊天记录全发过去"。 |
| 04 | [多模型适配](./04-multi-model-adapter) | Anthropic 和 OpenAI 的 API 格式完全不同。用适配器模式实现一套代码无缝切换不同厂商。 |
| 05 | [模拟测试](./05-mock-testing) | 每次测试都调真实 API 太慢太贵。用 ScriptedModel 预设响应做确定性测试，零 API 费用验证 Agent 逻辑。 |

---

## Part II · 工具与循环

> 核心问题：如何让 LLM 调用函数？如何实现 Agent Loop？

| # | 章节 | 简介 |
|---|------|------|
| 06 | [Tool Use 工具调用](./06-tool-use) | LLM 只能生成文本，怎样让它"做事"？实现工具调用协议：JSON Schema 声明工具、解析 tool_call、配对返回 tool_result。 |
| 07 | [Agent Loop 循环引擎](./07-agent-loop) | 从"一次调用"到"自主循环"。用 while 循环实现 Agent 的核心：LLM 自主决定调用工具 → 执行 → 反馈 → 直到任务完成。这是整个教程最关键的一章。 |
| 08 | [核心工具](./08-core-tools) | 实现 Coding Agent 的五个核心工具：read_file、write_file、edit_file、bash、search_files——覆盖完整编码闭环。 |

---

## Part III · 持久与可靠

> 核心问题：如何保存会话？如何管理上下文窗口？

| # | 章节 | 简介 |
|---|------|------|
| 09 | [会话持久化](./09-session-persistence) | 关掉终端对话就丢了？用 JSONL 格式逐条追加保存消息，实现崩溃安全的会话存储与恢复。 |
| 10 | [有状态 Agent](./10-stateful-agent) | 处理真实交互场景：用户按 Ctrl+C 怎么中断？运行中如何注入新指令（steering）？如何防止并发重入？ |
| 11 | [会话树](./11-session-tree) | 从线性对话到树形结构。支持分支、回溯、fork 的会话管理——想回到之前某个节点重新开始。 |
| 12 | [上下文窗口管理](./12-context-management) | 对话越来越长超出窗口怎么办？区分 Session 与 Context，按 token 预算从后往前保留消息，利用 Prompt Cache 优化性能。 |

---

## Part IV · 扩展与验证

> 核心问题：如何扩展能力？如何评测？如何防止幻觉？

| # | 章节 | 简介 |
|---|------|------|
| 13 | [扩展系统](./13-extension-system) | 怎样在不修改 Agent Loop 代码的前提下添加新能力？用事件系统和拦截器模式实现权限控制、知识注入等扩展。 |
| 14 | [打磨](./14-polish) | 从 "能跑" 到 "好用"：Banner、颜色、进度显示、错误提示、Spinner——CLI 产品体验的最后一公里。 |
| 15 | [评测](./15-evaluation) | "试了一次能跑" 不是可靠性证明。用 EvalCase 结构实现自动化评测，包括 Pass@k 指标和 LLM-as-Judge。 |
| 16 | [System Prompt 工程](./16-system-prompt-engineering) | 从一行 "You are a coding assistant" 到上百行结构化指令。设计分段组织的 System Prompt、动态注入、防 prompt injection。 |
| 17 | [Harness 工程](./17-harness) | 模型会幻觉、会死循环、会过早放弃。Harness 是 Agent Loop 外层的控制层——最大迭代数、连续错误检测、Proposer-Reviewer 模式。 |

---

## Part V · 生产级特性

> 核心问题：如何让 Agent 安全、高效、可协作？

| # | 章节 | 简介 |
|---|------|------|
| 18 | [权限系统](./18-permission-system) | Agent 能执行 shell 命令，不加约束就是灾难。实现分层权限模式、工具分类、allowlist/denylist、用户确认流程。 |
| 19 | [Hooks 事件系统](./19-hooks-system) | 在 Agent 生命周期的关键节点打开"窗口"——让外部逻辑观察、干预、改变行为，而不修改核心代码。 |
| 20 | [CLI 工具扩展](./20-cli-tools) | Agent 有 bash 工具意味着整个命令行生态都是工具箱。为 Agent 设计友好的 CLI 接口、结构化输出、工具发现机制。 |
| 21 | [并行执行与成本控制](./21-parallel-and-cost) | 模型一次返回多个工具调用，串行执行浪费时间。实现并行执行引擎、取消传播、Token 用量追踪与预算控制。 |
| 22 | [跨会话记忆](./22-memory-system) | 上下文压缩是遗忘，记忆系统是找回。实现会话笔记提取、持久记忆文件、记忆注入——让 Agent 越用越聪明。 |
| 23 | [多 Agent 协作](./23-multi-agent) | 一个 Agent 处理复杂任务容易迷失。把大问题拆给专门角色：Coordinator 调度、Worker 执行、消息传递、并行子代理。 |

---

## 附录

| # | 章节 | 简介 |
|---|------|------|
| 24 | [推荐阅读](./24-further-reading) | 超出本教程范围的高级话题指引：RAG 检索增强、模型后训练、Computer Use、安全对齐等进阶方向。 |

---

## 学习路线建议

**最短路径（理解核心原理）：** 第 0 → 1 → 6 → 7 → 8 章，约 2 小时

**完整路径（实现产品级 Agent）：** 第 0-23 章，约 20-30 小时

**按需选读：**
- 只关心 "Agent 是什么" → 第 0、7 章
- 只关心 "怎么接 API" → 第 1-5 章
- 只关心 "生产化" → 第 13-23 章
