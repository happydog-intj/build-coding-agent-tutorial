# 推荐阅读 — 下一步

> 本教程覆盖了 Coding Agent 的核心机制。以下是超出本教程范围、但值得深入了解的高级话题。

## 你已经掌握的

跟完 17 章后，你理解了：

- LLM 调用与协议（流式、多轮、多模型）
- Agent Loop 核心循环
- 工具系统（read / write / edit / bash / search）
- 会话持久化与状态管理
- 上下文窗口管理与 Prompt Cache
- 扩展系统与产品化打磨
- 评测体系（逻辑层 + 能力层）
- System Prompt 工程与防注入
- Harness 工程（重试、验证、防死循环）

这些是构建一个**单 Agent** 编码助手的完整知识。接下来的话题涉及更复杂的系统架构。

---

## 推荐资源

### 《深入理解 AI Agent》— 薄列峰

> https://bojieli.github.io/ai-agent-book/

这本书从更宏观的视角覆盖了 AI Agent 生态系统，以下章节与本教程互补性最强：

| 章节 | 话题 | 与本教程的关系 |
|------|------|---------------|
| 第 7 章 | RAG 与知识库 | 本教程的 Agent 只能读当前目录的文件。RAG 让 Agent 检索大规模知识库 |
| 第 8 章 | 多 Agent 协作 | 本教程是单 Agent。多 Agent 涉及任务分解、角色分工、通信协议 |
| 第 9 章 | 模型后训练（SFT / RL） | 本教程用现成模型。后训练让你针对特定任务微调 Agent 行为 |
| 第 10 章 | 语音 Agent | 本教程是文本交互。语音涉及 ASR/TTS、实时流、打断处理 |
| 第 11 章 | Computer Use | 本教程通过工具操作文件系统。Computer Use 让 Agent 操作 GUI |
| 第 12 章 | 持续进化 | 本教程的 Agent 是静态的。持续进化涉及在线学习、反馈循环 |

---

## 按话题的深入方向

### RAG 与长期记忆

本教程的 Agent 依赖上下文窗口内的信息。当项目有上万个文件时，Agent 无法全部读入。

核心思路：
- **向量检索**：把代码片段 embed 后存入向量数据库，按语义相似度检索
- **混合检索**：向量 + 关键词（BM25）结合，覆盖语义和精确匹配
- **Chunk 策略**：代码按函数/类切分比按固定长度切分效果更好

延伸阅读：
- [LangChain RAG Tutorial](https://python.langchain.com/docs/tutorials/rag/)
- [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)

---

### 多 Agent 协作

一个 Agent 处理复杂任务时容易迷失。多 Agent 把大任务拆给专门的角色：

- **Orchestrator 模式**：一个"指挥"Agent 分解任务，分发给"工人"Agent
- **Pipeline 模式**：Agent A 的输出是 Agent B 的输入（如：Coder → Reviewer → Tester）
- **Debate 模式**：多个 Agent 各自给出方案，互相评审，收敛到最优解

关键挑战：Agent 间的通信协议、上下文共享、死锁避免。

延伸阅读：
- [AutoGen](https://github.com/microsoft/autogen) — 微软的多 Agent 框架
- [CrewAI](https://github.com/crewAIInc/crewAI) — 角色扮演多 Agent

---

### 安全与对齐

本教程第 16 章介绍了 prompt injection 防御的基础。生产环境的安全话题更广：

- **沙箱隔离**：Agent 执行代码时的容器化、文件系统权限
- **权限最小化**：工具的 allowlist / denylist、目录限制
- **输出过滤**：防止 Agent 泄露敏感信息（API key、密码）
- **审计日志**：记录 Agent 的每一步操作，事后可追溯

---

### 模型后训练

当现成模型对你的特定任务表现不够好时：

- **SFT（Supervised Fine-Tuning）**：用高质量的 (prompt, response) 对微调模型
- **RLHF / DPO**：用人类偏好信号训练模型选择更好的策略
- **Tool-use 微调**：让模型更可靠地生成正确的工具调用格式

注意：微调需要大量高质量数据和 GPU 资源，通常在 Prompt Engineering + Harness 都不够用时才考虑。

---

### Computer Use（GUI Agent）

本教程的 Agent 通过 CLI 工具操作系统。另一条路是让 Agent 直接操作图形界面：

- **截图 + 坐标**：模型看屏幕截图，输出鼠标点击/键盘操作坐标
- **可访问性树**：直接读取 UI 的 accessibility tree，不依赖视觉
- **混合模式**：CLI + GUI 结合，能力互补

延伸阅读：
- [Anthropic Computer Use](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use)
- [OpenAI Operator](https://openai.com/operator/)

---

## 实践建议

1. **先把单 Agent 做好**。多 Agent 的前提是单 Agent 足够可靠
2. **评测先行**。任何改进（加 RAG、换模型、改 prompt）都需要评测来证明有效
3. **从简单场景开始**。不要一上来就做"通用 AI 开发者"，先做好一个具体场景（如：自动修 lint 错误）
4. **关注成本**。真实 Agent 每次运行可能消耗 $0.5-5 的 API 费用。优化 token 使用很重要
5. **Harness > 模型选择**。好的工程补救（重试、验证、防死循环）往往比换更贵的模型更有效

---

## 本教程的完整代码

```
examples/mini-pi-coding-agent/
├── src/           # 750 行完整 Agent 实现
├── demos/         # 17 个可运行 Demo
└── docs/tutorials/  # 18 篇教程文档
```

感谢阅读。去构建属于你的 Agent 吧。
