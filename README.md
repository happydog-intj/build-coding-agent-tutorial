# Mini Pi Coding Agent

一个最小化的 Coding Agent 实现，展示从零构建 AI 编程助手的核心原理。

## 快速开始

```bash
# 设置 API Key（二选一）
export ANTHROPIC_API_KEY=sk-ant-...
# 或
export OPENAI_API_KEY=sk-...

# 安装依赖
npm install

# 运行
npm start

# 指定模型
npm start -- --model=gpt-4o
```

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│  index.ts (CLI 入口)                                 │
│  readline 交互 + 流式输出 + 会话管理                    │
├─────────────────────────────────────────────────────┤
│  agent-loop.ts (核心 Agent Loop)                     │
│  [用户消息] → LLM → 有 tool call? → 执行 → 重复      │
├─────────────────────────────────────────────────────┤
│  tools/ (4 个核心工具)                                │
│  read_file | write_file | edit_file | bash           │
├─────────────────────────────────────────────────────┤
│  provider.ts (LLM Provider)                          │
│  pi-ai: 30+ provider 统一接口                         │
├─────────────────────────────────────────────────────┤
│  session.ts (JSONL 持久化)                            │
│  增量追加、崩溃安全、简单恢复                            │
└─────────────────────────────────────────────────────┘
```

## 核心设计原则

这些原则来自 Pi 项目 5600+ 次迭代的经验：

### 1. LLM 调用永不 throw

```typescript
// ✗ 错误做法：异常会中断 agent loop
const response = await llm.call(context); // 可能 throw!

// ✓ 正确做法：错误编码在响应中
const response = await streamFn(model, context);
// response.stopReason === "error" 表示失败，但循环不崩溃
```

### 2. 工具失败返回错误内容

```typescript
// ✗ 错误做法：throw 中断循环
async execute(params) {
  const content = await readFile(params.path); // throw if not found!
}

// ✓ 正确做法：返回错误让 LLM 自行处理
async execute(params) {
  try {
    const content = await readFile(params.path);
    return { content };
  } catch {
    return { content: "File not found", isError: true };
    // LLM 看到错误后会尝试其他方案
  }
}
```

### 3. 流式事件消费

```typescript
// 调用者通过事件流获取实时更新
for await (const event of stream) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta); // 逐 token 显示
  }
}
```

### 4. JSONL 持久化

```typescript
// 每条消息追加一行 JSON
appendFileSync(file, JSON.stringify(message) + "\n");
// 崩溃安全：部分写入的行在加载时被跳过
```

## 与 Pi 完整实现的对比

| 特性 | Mini Pi Coding Agent | Pi (完整版) |
|------|-----------|------------|
| Agent Loop | ~120 行手写 | ~500 行，双循环 + 7 个回调钩子 |
| 工具执行 | 顺序执行 | 并行执行 + beforeToolCall/afterToolCall 拦截 |
| UI | readline | 自研 TUI 引擎（差分渲染） |
| 扩展性 | 无 | Extension System（40+ 事件 + 工具/命令/Provider 注册） |
| 会话 | 线性 JSONL | Session Tree（DAG + 分支 + 压缩） |
| Provider | pi-ai（30+） | pi-ai + 动态注册 + OAuth |
| 上下文管理 | 无 | transformContext + compaction |
| 错误恢复 | 基本 | Harness（tagged errors + lane 并发 + 崩溃恢复） |

## 文件说明

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/agent-loop.ts` | ~120 | **核心**：Agent Loop 实现（教学重点） |
| `src/index.ts` | ~100 | CLI 交互层 |
| `src/provider.ts` | ~60 | LLM Provider 初始化 |
| `src/session.ts` | ~70 | JSONL 会话管理 |
| `src/tools/read.ts` | ~50 | 读文件工具 |
| `src/tools/write.ts` | ~30 | 写文件工具 |
| `src/tools/edit.ts` | ~70 | 编辑文件工具 |
| `src/tools/bash.ts` | ~80 | 执行命令工具 |

## 如何扩展

从这个 mini agent 出发，可以逐步添加：

1. **abort signal** — `Ctrl+C` 中断当前操作
2. **上下文窗口管理** — 消息太多时自动裁剪旧消息
3. **并行工具执行** — 多个工具调用同时执行
4. **beforeToolCall** — 在执行工具前请求用户确认（权限控制）
5. **模型切换** — 运行时切换不同模型
6. **Session Tree** — 支持对话分支和回溯

每一步对应 Pi 演化历史的一个阶段。详见 `docs/coding-agent-evolution.md`。

## 命令

在交互模式中可用的命令：

- `/quit` — 退出
- `/clear` — 清空当前会话
- `/session` — 显示会话信息
