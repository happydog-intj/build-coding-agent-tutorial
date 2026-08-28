# 第 22 章 Demo：跨会话记忆系统

用 ScriptedModel 模拟三种记忆机制，展示如何让 Agent 越用越聪明。无需 API key。

## 运行

```bash
cd demos/22-memory-system
npm install
npx tsx main.ts
```

## 输出示例

```
═══ 场景 1：会话记忆 — 实时笔记提取 ═══
  轮次 1 提取到：
    [偏好] Package manager: pnpm
    [关键文件] src/auth.ts
  轮次 2 提取到：
    [决策] use JWT with rotating keys
    [关键文件] src/middleware.ts
  轮次 3 提取到：
    [问题] the refresh token endpoint returns 401...

═══ 场景 2：持久记忆 — 写入/读取/注入 ═══
  写入 3 条持久记忆...
  新会话加载记忆...
    加载了 3 条记忆

═══ 场景 3：上下文压缩 — 记忆作为锚点 ═══
  原始对话（7 轮）
  压缩后：
    摘要: "Previously: set up JWT auth..."
    持久记忆: 3 条（不受压缩影响）
```

## 学到什么

- 会话记忆：实时从对话中提取 Decisions / Key Files / Problems / Preferences
- 持久记忆：用带 frontmatter 的 markdown 文件存储，跨会话可加载
- 记忆注入：将相关记忆拼入 system prompt，让模型拥有"长期记忆"
- 压缩锚点：上下文被压缩时，持久记忆不受影响，确保关键知识存活
- 关键认知：Agent 的智慧不只在模型参数里，也在它积累的记忆中
