# 第 14 章 Demo：打磨 — 完整 CLI 产品

集成所有章节概念的完整 Coding Agent CLI。这就是最终产品。

## 运行

```bash
cd demos/14-polish
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts

# 指定模型
npx tsx main.ts --model=gpt-4o

# 恢复会话
npx tsx main.ts --resume=<session-id>
```

## 功能清单

- ✅ 启动 Banner（模型、工具、退出方式）
- ✅ ANSI 彩色输出（工具黄色、成功绿、失败红、系统灰）
- ✅ 斜杠命令（/quit /clear /session /help）
- ✅ CLI 参数（--model= --resume=）
- ✅ 4 工具（read/write/edit/bash）
- ✅ Agent Loop（while 循环，自主多步）
- ✅ 工具调用可视化（名称 + 参数 + 结果预览）
- ✅ JSONL 持久化（崩溃安全，可恢复）
- ✅ 三层错误处理

## 学到什么

- 产品化 ≠ 加功能，是加"打磨"
- Banner 解决"这是什么 / 用的什么 / 怎么退出"
- ANSI 颜色建立视觉层次，不是装饰
- formatToolArgs 只提取关键参数，不是整个 JSON
- 三层错误：配置错误 → exit(1)，运行时 → 内部处理，未知 → 顶层 catch
