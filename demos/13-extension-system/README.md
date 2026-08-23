# 第 13 章 Demo：扩展系统

Agent Loop 核心不变，通过配置注入产品化逻辑。

## 运行

```bash
cd demos/13-extension-system
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts
```

## 试试

```
> 读取 package.json
> 执行 ls -la
> 执行 rm -rf /tmp/test       ← 触发权限确认！
> 打印所有环境变量            ← 触发 API key 脱敏
> /log                        ← 查看事件日志
```

## 学到什么

- `getSystemPrompt()` — 动态注入知识（目录、时间、项目规范）
- `beforeToolCall` — 权限控制（危险命令拦截 + 用户确认）
- `afterToolCall` — 结果变换（截断、脱敏）
- 事件回调 — 外部观察，不干预执行（日志、UI）
- 即使被拒绝也生成 toolResult → 保持 toolCallId 配对不变量
- Agent Loop ~80 行不变，产品化逻辑全在 config 里
