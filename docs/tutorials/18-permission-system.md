---
title: "权限系统 — 让 Agent 可信任"
description: "从无约束到分层权限：权限模式、工具分类、allowlist/denylist、用户确认流程"
---

# 第 18 章：权限系统 — 让 Agent 可信任

> Agent 能读文件、写代码、执行 Shell 命令。如果不加约束，一条 `rm -rf /` 就能让系统灰飞烟灭。权限系统是站在 AI 和真实系统之间的安全闸门。

## 这一章要解决什么问题？

到目前为止，我们的 Agent 是"全权限"的——用户说什么它就做什么，没有任何检查。这在学习阶段没问题，但放到生产环境就是灾难：

- Agent 可能执行超出用户意图的操作（用户说"清理临时文件"，它删了整个项目）
- 恶意 prompt 可能诱导 Agent 执行危险命令（prompt injection）
- Agent 读取的外部文件（如 CLAUDE.md）可能包含恶意指令

权限系统的目标：**让 Agent 有能力做事，但只在用户允许的范围内。**

---

## 工具的危险等级分类

第一步是给工具分类——不是所有工具都一样危险：

```typescript
type ToolRiskLevel = "safe" | "moderate" | "dangerous";

interface ToolDefinition {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  // ...
}

const TOOL_RISK_MAP: Record<string, ToolRiskLevel> = {
  read_file: "safe",        // 只读，不改变系统状态
  write_file: "moderate",   // 修改文件，但限于工作目录
  edit_file: "moderate",    // 同上
  bash: "dangerous",        // 可以执行任意命令
};
```

分类标准：

| 等级 | 含义 | 示例 |
|------|------|------|
| safe | 不改变系统状态 | read_file, search_files |
| moderate | 改变文件系统，但范围有限 | write_file, edit_file |
| dangerous | 可执行任意操作，后果不可预测 | bash, 网络请求 |

---

## 权限模式

不同场景需要不同的权限严格程度。定义几种"总开关"：

```typescript
type PermissionMode =
  | "default"          // 最严格：每次都确认
  | "acceptEdits"      // 自动允许文件编辑，Shell 仍需确认
  | "plan"             // 只读：只能看，不能改
  | "bypassPermissions" // 最宽松：跳过大部分检查
  | "dontAsk";         // 不弹确认框，直接拒绝不确定的操作
```

每种模式对不同风险等级的行为：

| 模式 | safe | moderate | dangerous |
|------|------|----------|-----------|
| default | ✅ 允许 | ❓ 确认 | ❓ 确认 |
| acceptEdits | ✅ 允许 | ✅ 允许 | ❓ 确认 |
| plan | ✅ 允许 | ❌ 拒绝 | ❌ 拒绝 |
| bypassPermissions | ✅ 允许 | ✅ 允许 | ✅ 允许 |
| dontAsk | ✅ 允许 | ❌ 拒绝 | ❌ 拒绝 |

---

## 权限检查流水线

权限检查不是简单的 yes/no，而是一个多层流水线：

```typescript
type PermissionDecision = "allow" | "deny" | "ask";

async function permissionPipeline(
  tool: string,
  args: Record<string, unknown>,
  mode: PermissionMode,
  rules: PermissionRules
): Promise<boolean> {
  // 第 1 层：模式基本策略（毫秒级）
  const modeDecision = checkMode(mode, TOOL_RISK_MAP[tool]);
  if (modeDecision !== "ask") return modeDecision === "allow";

  // 第 2 层：静态规则匹配（毫秒级）
  const ruleDecision = matchRules(tool, args, rules);
  if (ruleDecision !== "none") return ruleDecision === "allow";

  // 第 3 层：用户确认（秒级，阻塞）
  const userDecision = await askUserPermission(tool, args);
  return userDecision === "allow" || userDecision === "allowAlways";
}
```

设计原则：**快速路径优先**。绝大多数调用在第 1-2 层就能决定，只有不确定的才需要打断用户。

---

## Allowlist 与 Denylist

静态规则是最快的检查层——不需要等用户确认，直接放行或拒绝：

```typescript
interface PermissionRules {
  allow: PermissionRule[];
  deny: PermissionRule[];
}

interface PermissionRule {
  tool: string;          // 工具名，支持通配符
  pattern?: string;      // 参数匹配模式
  reason?: string;       // 规则说明
}

// 示例配置
const rules: PermissionRules = {
  allow: [
    { tool: "bash", pattern: "npm test*", reason: "允许运行测试" },
    { tool: "bash", pattern: "git status", reason: "允许查看状态" },
    { tool: "read_file", pattern: "*", reason: "读文件始终允许" },
  ],
  deny: [
    { tool: "bash", pattern: "rm -rf*", reason: "禁止递归删除" },
    { tool: "bash", pattern: "curl*|wget*", reason: "禁止网络下载" },
    { tool: "write_file", pattern: "/etc/*", reason: "禁止修改系统文件" },
  ],
};
```

匹配逻辑：deny 优先于 allow，具体规则优先于通配符：

```typescript
function matchRules(
  tool: string,
  args: Record<string, unknown>,
  rules: PermissionRules
): "allow" | "deny" | "none" {
  const input = buildMatchString(tool, args);

  // deny 优先检查
  for (const rule of rules.deny) {
    if (matchPattern(rule.tool, tool) && matchPattern(rule.pattern, input)) {
      return "deny";
    }
  }

  // 再检查 allow
  for (const rule of rules.allow) {
    if (matchPattern(rule.tool, tool) && matchPattern(rule.pattern, input)) {
      return "allow";
    }
  }

  return "none"; // 没有匹配的规则，走下一层
}
```

---

## 用户确认流程

当规则没有命中时，需要请求用户确认：

```typescript
async function askUserPermission(
  tool: string,
  args: Record<string, unknown>
): Promise<"allow" | "deny" | "allowAlways"> {
  const display = formatToolCall(tool, args);

  console.log(`\n⚠️  Agent 请求执行：`);
  console.log(`   工具: ${tool}`);
  console.log(`   参数: ${display}`);
  console.log(`\n   [y] 允许  [n] 拒绝  [a] 始终允许此类操作`);

  const answer = await readline.question("   > ");

  switch (answer.toLowerCase()) {
    case "y": return "allow";
    case "a": return "allowAlways";
    default:  return "deny";
  }
}
```

"始终允许"会动态添加到 allowlist 中，避免反复确认相同操作：

```typescript
if (decision === "allowAlways") {
  rules.allow.push({
    tool,
    pattern: buildPattern(tool, args),
    reason: "用户授权：始终允许",
  });
}
```

---

## 完整的权限检查实现

把各层组装成完整的检查流水线：

```typescript
async function checkPermission(
  tool: string,
  args: Record<string, unknown>,
  mode: PermissionMode,
  rules: PermissionRules
): Promise<boolean> {
  const riskLevel = TOOL_RISK_MAP[tool] ?? "dangerous";

  // 第 1 层：模式决定基本行为
  if (mode === "plan" && riskLevel !== "safe") {
    console.log(`🚫 Plan 模式下不允许 ${tool}`);
    return false;
  }
  if (mode === "bypassPermissions") {
    return true;
  }

  // 第 2 层：静态规则匹配
  const ruleResult = matchRules(tool, args, rules);
  if (ruleResult === "deny") {
    console.log(`🚫 规则拒绝: ${tool}`);
    return false;
  }
  if (ruleResult === "allow") {
    return true;
  }

  // 第 3 层：根据模式和风险等级决定是否需要确认
  if (mode === "acceptEdits" && riskLevel === "moderate") {
    return true; // 文件编辑自动允许
  }
  if (mode === "dontAsk") {
    return false; // 不确定就拒绝
  }

  // 第 4 层：请求用户确认
  const decision = await askUserPermission(tool, args);
  if (decision === "allowAlways") {
    return true;
  }
  return decision === "allow";
}
```

---

## 集成到 Agent Loop

在第 7 章的 Agent Loop 中，工具执行前加入权限检查：

```typescript
async function executeToolCall(
  toolCall: ToolCall,
  tools: Tool[],
  mode: PermissionMode,
  rules: PermissionRules
): Promise<ToolResult> {
  const tool = tools.find(t => t.name === toolCall.name);
  if (!tool) {
    return { content: `Unknown tool: ${toolCall.name}`, isError: true };
  }

  // 权限检查——在执行前拦截
  const allowed = await checkPermission(
    toolCall.name,
    toolCall.arguments,
    mode,
    rules
  );

  if (!allowed) {
    return {
      content: `Permission denied: ${toolCall.name} was blocked by permission policy.`,
      isError: true,
    };
  }

  // 通过检查，执行工具
  return tool.execute(toolCall.arguments);
}
```

注意：权限拒绝时返回 `isError: true` 而不是 throw。这让 Agent 知道操作被拒绝，可以换一种方式尝试——而不是让整个循环崩溃。

---

## 路径沙箱

对文件操作类工具，额外加一层路径检查——确保不会越权访问工作目录之外的文件：

```typescript
function isPathAllowed(filePath: string, workDir: string): boolean {
  const resolved = path.resolve(workDir, filePath);
  const normalized = path.normalize(resolved);

  // 必须在工作目录内
  if (!normalized.startsWith(path.normalize(workDir))) {
    return false;
  }

  // 禁止访问敏感文件
  const SENSITIVE_PATTERNS = [".env", ".ssh", ".aws", "credentials"];
  const basename = path.basename(normalized);
  if (SENSITIVE_PATTERNS.some(p => basename.includes(p))) {
    return false;
  }

  return true;
}
```

---

## 小结

权限系统是 Agent 从"能跑"到"可信任"的关键一步。核心设计：工具按危险等级分类（safe / moderate / dangerous），权限模式决定全局策略，Allowlist/Denylist 提供静态快速匹配，未命中规则时请求用户确认。整个流水线作为 `beforeToolCall` 拦截器集成到 Agent Loop 中。权限被拒绝时返回错误内容而非 throw，让 Agent 有机会调整策略。路径沙箱额外限制文件操作的范围，防止越权访问。这套机制不需要很复杂——几百行代码就能让 Agent 从"可能删掉你的硬盘"变成"只在你允许的范围内工作"。
