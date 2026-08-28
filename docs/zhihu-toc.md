# 从零实现 AI Coding Agent — 全部章节目录

> **Coding Agent = LLM + Protocol + Loop + Tools + State**
>
> 本教程共 24 章（知乎已发布前 18 章），分为 5 个阶段，从 30 行调用一次 LLM 到 750 行完整 Coding Agent，逐步拆解 AI 编程智能体的核心原理。
>
> 专栏地址：https://www.zhihu.com/column/c_2074206654749528083

---

## Part 0 · 序章

**第 00 章：[观察一次完整的 Agent 运行过程](https://zhuanlan.zhihu.com/p/2074206732428093412)**

在写代码之前先看全貌：一次 "读取文件并总结" 的请求如何走完 LLM 调用 → 工具执行 → 结果返回的完整闭环。建立直觉，理解 Agent 不是魔法，就是一个循环。

---

## Part I · 模型与协议

> 核心问题：如何调用 LLM？如何多轮对话？如何适配不同厂商？

**第 01 章：[Hello LLM — 30 行代码调用大模型](https://zhuanlan.zhihu.com/p/2074255528306423005)**

30 行 TypeScript 代码调用 Claude / GPT API 并获取回复。构建 Agent 的第一步——确认你能用代码拿到模型的输出。

**第 02 章：[EventStream 事件流 — 流式输出的秘密](https://zhuanlan.zhihu.com/p/2074261243565818915)**

实现流式输出，让模型回答逐字显示。理解 Server-Sent Events 协议和逐 token 渲染机制。

**第 03 章：[多轮对话 — 消息协议与记忆](https://zhuanlan.zhihu.com/p/2074380935835947113)**

模型为什么不记得上一句话？解答 messages 数组累积、角色区分、上下文传递——多轮对话的本质是"每次都把聊天记录全发过去"。

**第 04 章：[多模型适配 — 一套代码切换不同厂商](https://zhuanlan.zhihu.com/p/2074381499126891703)**

Anthropic 和 OpenAI 的 API 格式完全不同。用适配器模式实现一套代码无缝切换不同厂商。

**第 05 章：[模拟测试 — 不花钱验证 Agent 逻辑](https://zhuanlan.zhihu.com/p/2074383307412878166)**

每次测试都调真实 API 太慢太贵。用 ScriptedModel 预设响应做确定性测试，零 API 费用验证 Agent 逻辑。

---

## Part II · 工具与循环

> 核心问题：如何让 LLM 调用函数？如何实现 Agent Loop？

**第 06 章：[Tool Use 工具调用 — 让 LLM 调用函数](https://zhuanlan.zhihu.com/p/2074383668265627841)**

LLM 只能生成文本，怎样让它"做事"？实现工具调用协议：JSON Schema 声明工具、解析 tool_call、配对返回 tool_result。

**第 07 章：[Agent Loop 循环引擎 — 从一次调用到自主循环](https://zhuanlan.zhihu.com/p/2074397757184415286)**

从"一次调用"到"自主循环"。用 while 循环实现 Agent 的核心：LLM 自主决定调用工具 → 执行 → 反馈 → 直到任务完成。这是整个教程最关键的一章。

**第 08 章：[核心工具 — read / write / edit / bash](https://zhuanlan.zhihu.com/p/2074433444596152028)**

实现 Coding Agent 的五个核心工具：read_file、write_file、edit_file、bash、search_files——覆盖完整编码闭环。

---

## Part III · 持久与可靠

> 核心问题：如何保存会话？如何管理上下文窗口？

**第 09 章：[会话持久化 — JSONL 崩溃安全存储](https://zhuanlan.zhihu.com/p/2074447109793882882)**

关掉终端对话就丢了？用 JSONL 格式逐条追加保存消息，实现崩溃安全的会话存储与恢复。

**第 10 章：[有状态 Agent — abort、steering 与重入](https://zhuanlan.zhihu.com/p/2074477507902955862)**

处理真实交互场景：用户按 Ctrl+C 怎么中断？运行中如何注入新指令（steering）？如何防止并发重入？

**第 11 章：[会话树 — 分支、回溯与 DAG](https://zhuanlan.zhihu.com/p/2074524511848883334)**

从线性对话到树形结构。支持分支、回溯、fork 的会话管理——想回到之前某个节点重新开始。

**第 12 章：[上下文窗口管理 — 历史不动，上下文按预算重建](https://zhuanlan.zhihu.com/p/2074560329133057218)**

对话越来越长超出窗口怎么办？区分 Session 与 Context，按 token 预算从后往前保留消息，利用 Prompt Cache 优化性能。

---

## Part IV · 扩展与验证

> 核心问题：如何扩展能力？如何评测？如何防止幻觉？

**第 13 章：[扩展系统 — 不污染核心的产品化](https://zhuanlan.zhihu.com/p/2074624509114574435)**

怎样在不修改 Agent Loop 代码的前提下添加新能力？用事件系统和拦截器模式实现权限控制、知识注入等扩展。

**第 14 章：[打磨 — 从 Demo 到可用产品](https://zhuanlan.zhihu.com/p/2074790285087859000)**

从 "能跑" 到 "好用"：Banner、颜色、进度显示、错误提示、Spinner——CLI 产品体验的最后一公里。

**第 15 章：[评测 — 证明你的 Agent 能工作](https://zhuanlan.zhihu.com/p/2074790496027808280)**

"试了一次能跑" 不是可靠性证明。用 EvalCase 结构实现自动化评测，包括 Pass@k 指标和 LLM-as-Judge。

**第 16 章：[System Prompt 工程 — 从一行字符串到结构化指令](https://zhuanlan.zhihu.com/p/2075855990604424995)**

从一行 "You are a coding assistant" 到上百行结构化指令。设计分段组织的 System Prompt、动态注入、防 prompt injection。

**第 17 章：[Harness 工程 — 模型不可靠时的工程补救](https://zhuanlan.zhihu.com/p/2076235439560835078)**

模型会幻觉、会死循环、会过早放弃。Harness 是 Agent Loop 外层的控制层——最大迭代数、连续错误检测、Proposer-Reviewer 模式。

---

## Part V · 生产级特性

> 核心问题：如何让 Agent 安全、高效、可协作？

**第 18 章：[权限系统 — 让 Agent 可信任](https://zhuanlan.zhihu.com/p/2076589609207738604)**

Agent 能执行 shell 命令，不加约束就是灾难。实现分层权限模式、工具分类、allowlist/denylist、用户确认流程。

**第 19 章：Hooks 事件系统 — 生命周期扩展**（即将发布）

在 Agent 生命周期的关键节点打开"窗口"——让外部逻辑观察、干预、改变行为，而不修改核心代码。

**第 20 章：CLI 工具扩展 — Agent 最自然的能力接口**（即将发布）

Agent 有 bash 工具意味着整个命令行生态都是工具箱。为 Agent 设计友好的 CLI 接口、结构化输出、工具发现机制。

**第 21 章：并行执行与成本控制**（即将发布）

模型一次返回多个工具调用，串行执行浪费时间。实现并行执行引擎、取消传播、Token 用量追踪与预算控制。

**第 22 章：跨会话记忆 — 让 Agent 越用越聪明**（即将发布）

上下文压缩是遗忘，记忆系统是找回。实现会话笔记提取、持久记忆文件、记忆注入——让 Agent 越用越聪明。

**第 23 章：多 Agent 协作 — 从单兵到团队**（即将发布）

一个 Agent 处理复杂任务容易迷失。把大问题拆给专门角色：Coordinator 调度、Worker 执行、消息传递、并行子代理。

---

## 学习路线建议

**最短路径（理解核心原理）：** 第 0 → 1 → 6 → 7 → 8 章，约 2 小时

**完整路径（实现产品级 Agent）：** 第 0-23 章，约 20-30 小时

**按需选读：**
- 只关心 "Agent 是什么" → 第 0、7 章
- 只关心 "怎么接 API" → 第 1-5 章
- 只关心 "生产化" → 第 13-18 章

---

完整代码仓库：https://github.com/happydog-intj/build-coding-agent-tutorial

在线阅读（含代码高亮）：https://build-coding-agent-tutorial.vercel.app
