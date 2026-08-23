# 从零构建 Coding Agent — 教程目录

> 16 章渐进式教程，从 "30 行调用一次 LLM" 到 "750 行完整 Coding Agent"。
>
> 核心公式：**Coding Agent = LLM + Protocol + Loop + Tools + State**

## 目标读者

- 有 TypeScript / Node.js 基础
- 用过 ChatGPT 但没写过 Agent
- 想理解 Claude Code / Cursor / Cline 背后的原理

## 全局结构

```
Part 0  序章（1 章）        — 建立全局心智模型
Part I  模型与协议（5 章）  — 从调用到协议边界
Part II 工具与循环（3 章）  — 闭合 Agent 核心
Part III 持久与可靠（4 章） — 让 Agent 可靠
Part IV 扩展与验证（3 章） — 从核心到产品
```

---

## Part 0 · 序章

| # | 标题 | 解决的问题 |
|---|------|-----------|
| 00 | [观察一次完整的 Agent 运行](./00-observe-full-run.md) | 在动手之前，先看见全貌 — 一次请求怎样走完闭环？ |

---

## Part I · 模型与协议

| # | 标题 | 解决的问题 |
|---|------|-----------|
| 01 | [Hello LLM — 30 行代码调用大模型](./01-hello-llm.md) | 如何用代码调用 LLM 并获取回复？ |
| 02 | [EventStream 事件流 — 流式输出的秘密](./02-event-stream.md) | 等 10 秒才看到回复太痛苦了，如何逐字实时显示？ |
| 03 | [多轮对话 — 消息协议与记忆](./03-multi-turn.md) | 如何实现多轮对话？LLM 怎么记住上下文？ |
| 04 | [多模型适配 — 一套代码切换不同厂商](./04-multi-model-adapter.md) | Anthropic 和 OpenAI 格式完全不同，如何用同一套代码切换？ |
| 05 | [模拟测试 — 不花钱验证 Agent 逻辑](./05-mock-testing.md) | 每次测试都要调真实 API？太慢太贵，如何脱离真模型验证？ |

---

## Part II · 工具与循环

| # | 标题 | 解决的问题 |
|---|------|-----------|
| 06 | [Tool Use 工具调用 — 让 LLM 调用函数](./06-tool-use.md) | LLM 如何"动手"？一条工具调用怎样变成配对结果？ |
| 07 | [Agent Loop 循环引擎 — 从一次调用到自主循环](./07-agent-loop.md) | 如果 LLM 需要连续调用多个工具，如何让它自主工作直到完成？ |
| 08 | [核心工具 — read / write / edit / bash](./08-core-tools.md) | Coding Agent 最少需要哪些工具？怎么实现？ |

---

## Part III · 持久与可靠

| # | 标题 | 解决的问题 |
|---|------|-----------|
| 09 | [会话持久化 — JSONL 崩溃安全存储](./09-session-persistence.md) | 关掉终端对话就丢了，如何保存和恢复？ |
| 10 | [有状态 Agent — abort、steering 与重入](./10-stateful-agent.md) | 用户按了 Ctrl+C 怎么办？运行中如何注入新指令？ |
| 11 | [会话树 — 分支、回溯与 DAG](./11-session-tree.md) | 线性会话只有一条路，如何支持"回到之前某个点重新对话"？ |
| 12 | [上下文窗口管理 — 历史不动，上下文按预算重建](./12-context-management.md) | 对话越来越长，超出模型的上下文窗口怎么办？ |

---

## Part IV · 扩展与验证

| # | 标题 | 解决的问题 |
|---|------|-----------|
| 13 | [扩展系统 — 不污染核心的产品化](./13-extension-system.md) | 如何在不修改 Agent Loop 代码的前提下添加新能力？ |
| 14 | [打磨 — 从 Demo 到可用产品](./14-polish.md) | 如何让 agent 从"能跑"变成"好用"？ |
| 15 | [评测 — 证明你的 Agent 能工作](./15-evaluation.md) | 如何客观验证 agent 的能力？ |

---

## 章节依赖图

```
00 序章（观察）
 ↓
01 Hello LLM → 02 EventStream 事件流 → 03 多轮对话
                                          ↓
                              04 多模型适配 → 05 模拟测试
                                                  ↓
                     06 Tool Use 工具调用 → 07 Agent Loop 循环引擎 → 08 核心工具
                                                                       ↓
                              09 会话持久化 → 10 有状态 Agent → 11 会话树
                                                                 ↓
                                          12 上下文管理 → 13 扩展系统
                                                              ↓
                                                    14 打磨 → 15 评测
```

## 每章结构

每篇教程遵循统一格式：

1. **问题** — 一句话：这章要解决什么
2. **概念** — 图示 + 最小解释 + 不变量
3. **代码** — 完整可运行的增量代码，带注释
4. **运行验证** — 读者能执行什么命令验证效果
5. **为什么这样设计** — 与"常见但错误"的做法对比
6. **下一章预告** — 引出新问题

## 最终产出

跟完全部 16 章后，你将拥有一个 750 行、独立可运行的 Coding Agent：

```
examples/mini-pi-coding-agent/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts            # CLI + Runtime 组装（~150 行）
    ├── agent-loop.ts       # Agent Loop 循环引擎（~165 行）
    ├── provider.ts         # 多模型适配（~90 行）
    ├── session.ts          # JSONL 持久化（~80 行）
    └── tools/
        ├── index.ts        # 工具注册（~12 行）
        ├── read.ts         # 读文件（~54 行）
        ├── write.ts        # 写文件（~34 行）
        ├── edit.ts         # 编辑（~75 行）
        └── bash.ts         # 命令（~90 行）
```
