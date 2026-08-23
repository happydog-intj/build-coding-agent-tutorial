# 第 09 章 Demo：会话持久化

JSONL 格式存储对话历史。关掉终端后可以恢复。

## 运行

```bash
cd demos/09-session-persistence
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts

# 对话几轮后 /quit 退出，然后恢复：
npx tsx main.ts --resume=2024-06-15_143022_a7x2
```

## 试试

```
> 你好，我在学 Agent
> 什么是 Agent Loop？
> /history        ← 查看 JSONL 文件内容
> /session        ← 查看会话信息
> /quit           ← 退出（提示 resume 命令）
```

## 学到什么

- JSONL = 每行一条 JSON，追加写入（`appendFileSync`）
- 崩溃安全：只可能丢最后一条未写完的消息
- `loadSession` 容忍损坏行（`try/catch` + skip）
- 同步写 vs 异步写：同步保证返回时数据已到文件系统
- Session ID 用日期+时间+随机后缀，文件名即可读
