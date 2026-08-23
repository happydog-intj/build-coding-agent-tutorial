# 第 11 章 Demo：会话树

messages 从线性数组变成 DAG。支持编辑历史消息（fork）、retry、分支切换。

## 运行

```bash
cd demos/11-session-tree
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts
```

## 试试

```
> 什么是 Agent？
> 能举个例子吗？
> /edit 0 什么是 LLM？          ← 编辑第 0 条消息（fork 到新分支）
> /tree                         ← 查看整棵树结构
> /branches                     ← 列出当前节点的兄弟分支
> /switch 0                     ← 切回原来的分支
> /retry                        ← 重新生成当前回复
> /path                         ← 打印 active path
```

## 学到什么

- 每条消息有 `id` + `parentId`，形成 DAG
- Active path = 从根到当前叶子的路径（传给模型的 messages）
- Fork = 在同一个 parentId 下创建新节点（编辑、retry 都是 fork）
- 只追加不修改：旧分支永远保留
- 切换分支只需改 `currentLeafId`
- Retry = 把 currentLeafId 回退到 assistant 的 parent，重新调模型
