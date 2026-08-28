# 第 19 章 Demo：Hooks 事件系统

用 ScriptedModel 模拟工具调用，演示 Hooks 如何扩展 Agent 生命周期行为。无需 API key。

## 运行

```bash
cd demos/19-hooks-system
npm install
npx tsx main.ts
```

## 输出示例

```
═══ 场景 1：PreToolUse 审计 — 记录 bash 命令 ═══

  → [PreToolUse] audit-logger: continue (记录命令: npm test)
  → [PreToolUse] audit-logger: continue (记录命令: git status)

  （read_file 不匹配 bash matcher，审计 Hook 跳过）

═══ 场景 2：PreToolUse 过滤 — 拦截含 secret 的命令 ═══

  → [PreToolUse] audit-logger: continue (记录命令: echo $API_KEY)
  ✗ [PreToolUse] secret-filter: block (命令包含敏感词「API_KEY」)
  → [PreToolUse] audit-logger: continue (记录命令: export password=123)
  ✗ [PreToolUse] secret-filter: block (命令包含敏感词「password」)
  → [PreToolUse] audit-logger: continue (记录命令: npm install lodash)
  → [PreToolUse] secret-filter: continue

═══ 场景 3：PostToolUse 自动格式化 — 追加换行 ═══

  ~ [PostToolUse] auto-newline: modify (追加尾部换行)
  → [PostToolUse] auto-newline: continue (已有换行，无需修改)

═══ 场景 4：Stop 通知 — 会话结束摘要 ═══

  → [Stop] session-summary: continue (会话结束，共 7 次工具调用)
```

## 学到什么

- Hooks = 不修改核心代码的行为扩展机制
- 三个事件覆盖完整生命周期：PreToolUse / PostToolUse / Stop
- Handler 支持两种类型：command（shell 命令）和 function（内联逻辑）
- 三种结果动作：continue（放行）/ block（拦截）/ modify（修改后继续）
- matcher 字段实现精确的工具匹配（只对特定工具生效）
- 典型场景：审计日志、安全过滤、自动格式化、会话通知
- 声明式配置（JSON）让 Hooks 可复用、可版本化
