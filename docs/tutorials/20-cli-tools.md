---
title: "CLI 工具扩展 — Agent 最自然的能力接口"
description: "用 CLI 工具替代 MCP：为 Agent 设计友好的命令行接口、结构化输出、工具发现机制"
---

# 第 20 章：CLI 工具扩展 — Agent 最自然的能力接口

> Agent 有一个 bash 工具，这意味着整个命令行生态都是它的工具箱。不需要写 SDK 适配器，不需要搭协议服务器——一个设计良好的 CLI 就是最好的 Agent 扩展。

## 这一章要解决什么问题？

你的 Agent 需要查询 Jira 工单、操作数据库、调用内部 API。传统做法是为每个能力写一个 Tool 类注册到 Agent 中。但这有两个问题：

1. **扩展成本高**：每加一个能力就要改 Agent 代码、重新部署
2. **能力不可复用**：你写的 Tool 只能在你的 Agent 里用

更自然的方式：**让 Agent 通过 bash 工具调用现成的 CLI**。`gh`（GitHub CLI）、`jq`（JSON 处理）、`curl`（HTTP 请求）、`psql`（PostgreSQL）——这些都是 Agent 可以直接使用的"工具"。

---

## 为什么 CLI 优于专用协议

| 对比维度 | 专用 Tool 注册 | MCP Server | CLI 工具 |
|----------|---------------|-----------|----------|
| 开发成本 | 写 Tool 类 + 注册 | 实现协议 + 传输层 | 写个命令行程序 |
| 部署 | 跟 Agent 一起 | 独立进程/服务 | `npm install -g` 或 `brew install` |
| 语言限制 | 必须和 Agent 同语言 | 任意（有 SDK） | 任意语言 |
| 可复用性 | 仅限该 Agent | 跨 AI 应用 | 任何人/程序都能用 |
| 调试 | 需要 Agent 环境 | 需要协议工具 | 终端直接跑 |
| 生态 | 自己写 | 社区 MCP Server | 海量现有 CLI |

Claude Code 实际工作中 90% 的外部能力都是通过 CLI 获取的：

```bash
gh pr list --json number,title,state     # GitHub 操作
git log --oneline -10                     # 版本历史
npm test                                  # 运行测试
curl -s https://api.example.com/status    # HTTP 请求
psql -c "SELECT count(*) FROM users"     # 数据库查询
kubectl get pods --output json            # K8s 状态
```

---

## 设计对 Agent 友好的 CLI

Agent 不是人——它不能"看"彩色输出，不能交互式操作。对 Agent 友好的 CLI 需要满足：

### 1. 结构化输出

```bash
# ✗ 对人友好但 Agent 难解析
$ my-tool status
Deploy Status: ✅ Success
Version: 1.2.3
Time: 2 minutes ago

# ✓ JSON 输出，Agent 可直接解析
$ my-tool status --json
{"status":"success","version":"1.2.3","deployedAt":"2024-01-15T10:30:00Z"}
```

实现模式：

```typescript
// CLI 工具的输出策略
import { Command } from "commander";

const program = new Command();

program
  .command("status")
  .option("--json", "输出 JSON 格式")
  .action((opts) => {
    const result = getStatus();

    if (opts.json) {
      // Agent 友好：结构化 JSON
      console.log(JSON.stringify(result));
    } else {
      // 人类友好：格式化显示
      console.log(`Status: ${result.status}`);
      console.log(`Version: ${result.version}`);
    }
  });
```

### 2. 明确的退出码

```typescript
// 退出码约定
process.exit(0);  // 成功
process.exit(1);  // 一般错误
process.exit(2);  // 参数错误

// Agent 可以通过退出码判断是否成功，无需解析输出
```

### 3. 自描述的 --help

```bash
$ my-deploy --help
Usage: my-deploy [options] <environment>

Deploy the application to the specified environment.

Arguments:
  environment    Target environment (staging|production)

Options:
  --branch <b>  Branch to deploy (default: main)
  --dry-run     Show what would be deployed without executing
  --json        Output result as JSON
  -h, --help    Show this help

Examples:
  my-deploy staging --branch feature/new-ui
  my-deploy production --dry-run --json
```

Agent 可以通过 `--help` 学习如何使用一个陌生的工具。在 system prompt 中不需要列出所有参数细节——只需告诉 Agent 工具存在，它会自己查 help。

### 4. 非交互模式

```typescript
// ✗ 需要交互输入
const answer = await inquirer.prompt("Are you sure?");

// ✓ 通过参数跳过确认
program
  .option("--yes", "跳过确认提示")
  .option("--force", "强制执行")
  .action((opts) => {
    if (!opts.yes && !opts.force) {
      // 检测是否在 TTY 中运行
      if (!process.stdin.isTTY) {
        console.error("Error: requires --yes flag in non-interactive mode");
        process.exit(2);
      }
    }
  });
```

---

## Agent 如何发现 CLI 工具

Agent 需要知道有哪些 CLI 可用。两种策略：

### 策略 1：System Prompt 声明

在 system prompt 中列出可用工具：

```typescript
const systemPrompt = `你是一个编码助手。

可用的 CLI 工具：
- gh: GitHub CLI，用于 PR、Issue、Actions 操作
- jq: JSON 处理，用于解析和转换 JSON 数据
- my-deploy: 内部部署工具，用 --help 查看用法
- db-query: 数据库查询工具，支持 --json 输出

使用 bash 工具调用这些 CLI。对于不熟悉的工具，先运行 --help 了解用法。`;
```

### 策略 2：工具清单文件

在项目目录放一个描述文件（类似 CLAUDE.md）：

```markdown
<!-- .agent/tools.md -->
# 可用 CLI 工具

## my-deploy
部署应用到指定环境。
```bash
my-deploy <staging|production> [--branch <b>] [--dry-run] [--json]
```

## db-query
查询数据库并返回结果。
```bash
db-query "SELECT * FROM users WHERE active = true" --format json
```

## code-search
全文搜索代码库（比 grep 更智能，支持语义搜索）。
```bash
code-search "authentication logic" --top 5 --json
```
```

Agent 启动时读取这个文件，就知道有哪些工具可用。

---

## 实例：为 Agent 写一个 CLI 工具

假设你需要让 Agent 能查询内部服务的健康状态：

```typescript
#!/usr/bin/env npx tsx
// tools/service-health.ts

import { Command } from "commander";

interface ServiceStatus {
  name: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  lastCheck: string;
}

const program = new Command()
  .name("service-health")
  .description("查询内部服务健康状态")
  .argument("[service]", "服务名称，不指定则查询全部")
  .option("--json", "JSON 格式输出")
  .action(async (service, opts) => {
    const services = await fetchServiceStatus(service);

    if (opts.json) {
      console.log(JSON.stringify(services, null, 2));
    } else {
      for (const s of services) {
        const icon = s.status === "healthy" ? "✅" : s.status === "degraded" ? "⚠️" : "❌";
        console.log(`${icon} ${s.name}: ${s.status} (${s.latencyMs}ms)`);
      }
    }

    // 退出码反映整体状态
    const hasDown = services.some(s => s.status === "down");
    process.exit(hasDown ? 1 : 0);
  });

async function fetchServiceStatus(name?: string): Promise<ServiceStatus[]> {
  const res = await fetch("http://internal-api/health");
  const all: ServiceStatus[] = await res.json();
  return name ? all.filter(s => s.name === name) : all;
}

program.parse();
```

Agent 使用方式：

```
> 检查一下 payment 服务是否正常

Agent 调用 bash: service-health payment --json
Agent 看到: {"name":"payment","status":"degraded","latencyMs":2300,"lastCheck":"..."}
Agent 回复: payment 服务状态为 degraded，延迟 2300ms，建议排查...
```

---

## CLI vs MCP：什么时候用哪个

| 场景 | 推荐 | 原因 |
|------|------|------|
| Agent 调用现有命令行工具 | CLI | 已经存在，直接用 |
| 为自己的 Agent 加能力 | CLI | 开发最快，调试最容易 |
| 做一个工具给多个 AI 应用用 | MCP | 标准协议，跨应用复用 |
| 需要长连接/推送通知 | MCP | CLI 是请求-响应模式 |
| 需要 OAuth 认证流程 | MCP | 协议内置认证支持 |
| 工具需要维护状态 | MCP | Server 进程常驻，有内存 |
| 快速原型验证 | CLI | 5 分钟写完就能用 |

**经验法则**：先用 CLI 验证需求，确认有长期价值后再考虑包装成 MCP Server。

---

## 组合 CLI 工具的威力

Agent 的真正优势不是调用单个工具，而是**组合多个 CLI 完成复杂任务**：

```bash
# Agent 可能生成的命令序列：

# 1. 查找最近失败的 CI
gh run list --status failure --limit 1 --json databaseId,headBranch

# 2. 获取失败日志
gh run view 12345 --log-failed

# 3. 定位相关代码
grep -rn "ConnectionTimeout" src/

# 4. 检查最近改动
git log --oneline -5 -- src/database/

# 5. 查看服务状态
service-health database --json
```

这种组合能力是 Agent + CLI 生态的核心价值——不需要预先设计"查 CI 失败原因"这个专用工具，Agent 可以自己把多个通用工具串起来解决问题。

---

## 小结

CLI 工具是 Agent 最自然的扩展方式。Agent 已经有 bash 工具，整个命令行生态都是它的能力来源。设计对 Agent 友好的 CLI 要做到：结构化 JSON 输出、明确的退出码、自描述的 `--help`、非交互模式。通过 system prompt 或工具清单文件让 Agent 发现可用工具。CLI 的优势是开发快、调试容易、可复用性强；MCP 的优势是跨应用标准协议和长连接支持。实际工程中，90% 的场景 CLI 就够了，Agent 的组合调用能力会把简单的 CLI 变成强大的解决方案。
