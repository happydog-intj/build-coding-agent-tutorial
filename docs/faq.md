---
description: "关于从零构建 Coding Agent 教程的常见问题：Agent Loop 原理、工具调用机制、上下文管理等"
---

# 常见问题 FAQ

## 什么是 Coding Agent？

Coding Agent 是一种 AI 程序，它能够自主地读取代码、编写代码、运行测试，完成编程任务。Claude Code、Cursor、Cline 都属于 Coding Agent。

其核心公式是：**Coding Agent = LLM + Protocol + Loop + Tools + State**

## Agent Loop 是什么？怎么实现？

Agent Loop 是 Coding Agent 的核心循环引擎。它的伪代码是：

```
while (true) {
  response = callLLM(messages)
  if (response 没有 tool_call) break  // 任务完成
  result = executeTool(response.tool_call)
  messages.push(response, result)      // 把结果放回去继续
}
```

模型自主决定是否需要调用工具、调用哪个工具、什么时候停止。程序只负责执行工具并把结果反馈给模型。详见[第 07 章](./tutorials/07-agent-loop.md)。

## Coding Agent 最少需要哪些工具？

五个核心工具即可覆盖完整的编码操作闭环：

1. **read_file** — 读取文件内容（带行号，支持分段）
2. **write_file** — 创建新文件（自动创建父目录）
3. **edit_file** — 精确修改文件（字符串匹配替换，避免行号漂移）
4. **bash** — 执行命令（带 timeout 和输出截断）
5. **search_files** — 搜索代码（正则匹配，限制结果数量）

详见[第 08 章](./tutorials/08-core-tools.md)。

## Tool Use（工具调用）的协议是怎样的？

LLM 不能直接执行代码。它通过 JSON 格式的 tool_call 请求告诉程序要调用什么工具：

```json
{
  "type": "tool_call",
  "name": "read_file",
  "arguments": { "path": "src/app.ts" }
}
```

程序执行工具后，把结果作为 tool_result 消息放回对话中。模型看到结果后决定下一步。这就是 Tool Use Protocol。详见[第 06 章](./tutorials/06-tool-use.md)。

## 上下文窗口满了怎么办？

区分 Session（完整历史，永久存储）和 Context（每次调用临时构建，可截断）。截断规则：

- 以"不可拆分的交互"为最小单位（tool_call 和 tool_result 必须成对保留）
- 从后往前保留最新的消息
- 保持 system prompt 前缀稳定（利用 Prompt Cache 节省 90% 费用）

详见[第 12 章](./tutorials/12-context-management.md)。

## 如何防止 Agent 死循环或幻觉？

Harness 工程提供四道防线：

1. **最大迭代数** — 超过 N 轮强制终止
2. **连续错误检测** — 连续失败时注入策略修正
3. **输出验证** — Agent 说"完成了"后自动验证结果
4. **Proposer-Reviewer 模式** — 两个模型互相审查

详见[第 17 章](./tutorials/17-harness.md)。

## 这个教程和 LangChain / AutoGen 有什么不同？

本教程不使用任何框架，从零用 TypeScript 实现每一个组件。目的是让你理解原理，而不是学一个 API。学完后你能：

- 看懂 Claude Code / Cursor 的架构设计
- 自己从零实现一个 Agent（不依赖框架）
- 评估各种 Agent 框架的设计决策是否合理

## 需要什么前置知识？

- TypeScript / Node.js 基础
- 用过 ChatGPT（知道什么是 LLM）
- 不需要机器学习知识

## 学完需要多久？

按顺序阅读约 10-20 小时。每章独立可运行，可以跳着学。

## 需要 API Key 吗？

18 章中有 4 章不需要 API Key（第 05、12、16、17 章）。其余章节需要 Anthropic 或 OpenAI 的 API Key。评测章（第 15 章）的逻辑层测试也不需要 Key。
