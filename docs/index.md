---
layout: home
title: "从零构建 Coding Agent — TypeScript 教程"
description: "18 章渐进式教程，从 30 行调用 LLM 到 750 行完整 Coding Agent。理解 Claude Code、Cursor 背后的原理。"
hero:
  name: 从零构建 Coding Agent
  text: 18 章渐进式 TypeScript 教程
  tagline: 从 "30 行调用一次 LLM" 到 "750 行完整 Coding Agent"
  actions:
    - theme: brand
      text: 开始阅读 →
      link: /tutorials/00-observe-full-run
    - theme: alt
      text: GitHub ⭐
      link: https://github.com/happydog-intj/build-coding-agent-tutorial
features:
  - icon: 🧠
    title: 核心公式
    details: "Coding Agent = LLM + Protocol + Loop + Tools + State"
  - icon: 🎯
    title: 面向实践
    details: 每章解决一个具体问题，配套可运行的 Demo 代码
  - icon: 🛠️
    title: 五个核心工具
    details: read_file、write_file、edit_file、bash、search_files — 覆盖完整编码闭环
  - icon: 📐
    title: 750 行完整实现
    details: 不是玩具 — 最终产出是一个能读文件、写代码、跑测试的完整 Agent
---

## 为什么写这个教程？

Claude Code、Cursor、Cline 这些 AI 编程工具的背后，核心原理其实并不复杂。一个 Coding Agent 本质上就是一个 **while 循环**：调用 LLM → 检查是否有工具调用 → 执行工具 → 把结果放回对话 → 重复。

但从"理解原理"到"自己实现一个能用的"，中间还有大量工程细节：流式输出怎么做？多模型怎么适配？上下文窗口满了怎么办？模型幻觉了怎么补救？

这个教程用 **18 章** 逐步回答这些问题，每章都有可运行的代码。

## 教程结构

| 阶段 | 章节 | 核心问题 |
|------|------|----------|
| **序章** | 第 0 章 | 先看全貌——一次请求如何走完闭环？ |
| **模型与协议** | 第 1-5 章 | 如何调用 LLM？如何多轮对话？如何适配不同厂商？ |
| **工具与循环** | 第 6-8 章 | 如何让 LLM 调用函数？如何实现 Agent Loop？ |
| **持久与可靠** | 第 9-12 章 | 如何保存会话？如何管理上下文窗口？ |
| **扩展与验证** | 第 13-17 章 | 如何扩展能力？如何评测？如何防止幻觉？ |

## 适合谁

- ✅ 有 TypeScript / Node.js 基础
- ✅ 用过 ChatGPT 但没写过 Agent
- ✅ 想理解 Claude Code / Cursor / Cline 的实现原理
- ✅ 想自己从零实现一个 AI 编程助手

## 快速开始

```bash
git clone https://github.com/happydog-intj/build-coding-agent-tutorial
cd build-coding-agent-tutorial/demos/07-agent-loop
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts
```

每个 demo 目录都是独立项目，可以直接运行。
