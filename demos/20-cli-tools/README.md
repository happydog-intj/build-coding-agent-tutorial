# 第 20 章 Demo：CLI 工具扩展

Agent 最自然的能力接口：bash + JSON = 万能工具协议。无需 API key。

## 运行

```bash
cd demos/20-cli-tools
npm install
npx tsx main.ts
```

## 输出示例

```
═══ 场景 1：Agent 友好的 CLI 输出 ═══
  [人类友好输出] my-deploy staging
  🚀 Deploying to staging...
  ✅ Deploy successful!

  [Agent 友好输出] my-deploy staging --json
  {"status":"success","environment":"staging","version":"v2.4.1",...}
  → --json 让 Agent 直接解析结构化数据，无需正则提取

═══ 场景 2：工具发现 — 读取工具清单 ═══
  工具数量: 2
  ├─ my-deploy: Deploy application to specified environment
  ├─ my-logs: Query application logs with structured output
  → Agent 读取清单后知道：有哪些工具、怎么用、输出格式

═══ 场景 3：Agent 通过 bash 调用 CLI 并解析结果 ═══
  Step 1: $ cat tool-manifest.json
  Step 2: $ my-deploy staging --json
  → Agent 用 bash 工具 + --json 标志 = 万能工具调用
```

## 学到什么

- Agent 友好 CLI 四要素：--json、语义化退出码、--help、非交互式
- 工具清单（tool-manifest.json）让 Agent 一次性发现所有可用工具
- bash + JSON 是零依赖的 Agent 工具协议，任何 CLI 加 --json 即可
- 人类友好输出适合终端，JSON 输出适合 Agent — 一个 CLI 服务两种用户
