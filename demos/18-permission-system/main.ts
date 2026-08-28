/**
 * 第 18 章：权限系统 — 分层权限 / allowlist / denylist / 用户确认
 *
 * 用 ScriptedModel 模拟工具调用，演示权限管道如何决策：
 * 1. 工具风险分级（safe / moderate / dangerous）
 * 2. 权限模式（default / acceptEdits / plan / bypassPermissions）
 * 3. Allowlist / Denylist 规则匹配（glob 模式）
 * 4. 权限管道：模式检查 → 规则匹配 → 用户确认
 * 5. 路径沙箱（限制文件操作在项目目录内）
 *
 * 无需 API key！
 *
 * 运行方式：
 *   npx tsx main.ts
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";

// ─── 风险分级 ──────────────────────────────────────────────────────────────────

type RiskLevel = "safe" | "moderate" | "dangerous";

interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

const TOOL_RISK: Record<string, RiskLevel> = {
  read_file: "safe",
  list_files: "safe",
  write_file: "moderate",
  edit_file: "moderate",
  bash: "dangerous",
  delete_file: "dangerous",
};

function classifyRisk(tool: ToolCall): RiskLevel {
  return TOOL_RISK[tool.name] ?? "dangerous";
}

// ─── 权限模式 ──────────────────────────────────────────────────────────────────

type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

/** 模式对各风险等级的默认决策 */
const MODE_POLICY: Record<PermissionMode, Record<RiskLevel, "allow" | "confirm" | "block">> = {
  default:           { safe: "allow", moderate: "confirm", dangerous: "confirm" },
  acceptEdits:       { safe: "allow", moderate: "allow",   dangerous: "confirm" },
  plan:              { safe: "allow", moderate: "block",   dangerous: "block" },
  bypassPermissions: { safe: "allow", moderate: "allow",   dangerous: "allow" },
};

// ─── Allowlist / Denylist ───────────────────────────────────────────────────────

interface PermissionRule {
  pattern: string;   // glob 风格：* 匹配任意
  action: "allow" | "deny";
}

function matchGlob(pattern: string, value: string): boolean {
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return regex.test(value);
}

function matchRules(rules: PermissionRule[], toolCall: ToolCall): "allow" | "deny" | null {
  // 构建匹配字符串：tool_name 或 tool_name:arg
  const candidates = [toolCall.name];
  if (toolCall.name === "bash" && toolCall.arguments.command) {
    candidates.push(`bash:${toolCall.arguments.command}`);
  }
  if (toolCall.arguments.path) {
    candidates.push(`${toolCall.name}:${toolCall.arguments.path}`);
  }

  for (const rule of rules) {
    for (const candidate of candidates) {
      if (matchGlob(rule.pattern, candidate)) return rule.action;
    }
  }
  return null; // 无匹配规则
}

// ─── 路径沙箱 ──────────────────────────────────────────────────────────────────

function isPathSafe(path: string, projectDir: string): boolean {
  const resolved = path.startsWith("/") ? path : `${projectDir}/${path}`;
  return resolved.startsWith(projectDir);
}

function checkPathSandbox(toolCall: ToolCall, projectDir: string): boolean {
  const pathArg = toolCall.arguments.path ?? toolCall.arguments.file;
  if (!pathArg) return true; // 无路径参数，不需要检查
  return isPathSafe(pathArg, projectDir);
}

// ─── 权限管道 ──────────────────────────────────────────────────────────────────

type Decision = "allow" | "deny" | "confirm" | "block";

interface PermissionResult {
  decision: Decision;
  reason: string;
}

function evaluatePermission(
  toolCall: ToolCall,
  mode: PermissionMode,
  rules: PermissionRule[],
  projectDir: string,
): PermissionResult {
  // Step 1: 路径沙箱检查
  if (!checkPathSandbox(toolCall, projectDir)) {
    return { decision: "deny", reason: "路径沙箱：越权访问项目目录外的文件" };
  }

  // Step 2: Denylist 检查（deny 规则优先）
  const denyRules = rules.filter(r => r.action === "deny");
  const denyMatch = matchRules(denyRules, toolCall);
  if (denyMatch === "deny") {
    return { decision: "deny", reason: "Denylist 规则匹配" };
  }

  // Step 3: Allowlist 检查
  const allowRules = rules.filter(r => r.action === "allow");
  const allowMatch = matchRules(allowRules, toolCall);
  if (allowMatch === "allow") {
    return { decision: "allow", reason: "Allowlist 规则匹配" };
  }

  // Step 4: 模式策略（兜底）
  const risk = classifyRisk(toolCall);
  const decision = MODE_POLICY[mode][risk];
  return { decision, reason: `模式策略 [${mode}] + 风险等级 [${risk}]` };
}

// ─── 辅助输出 ──────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[90m",
};

function printDecision(tool: ToolCall, result: PermissionResult) {
  const icon = result.decision === "allow" ? `${C.green}✓ ALLOW`
    : result.decision === "deny" || result.decision === "block" ? `${C.red}✗ DENY`
    : `${C.yellow}? CONFIRM`;
  const cmdStr = tool.name === "bash" ? `bash: ${tool.arguments.command}` : `${tool.name}: ${tool.arguments.path ?? ""}`;
  console.log(`  ${icon}${C.reset}  ${cmdStr}`);
  console.log(`  ${C.dim}       原因: ${result.reason}${C.reset}`);
}

// ─── 场景演示 ──────────────────────────────────────────────────────────────────

console.log(`${C.cyan}第 18 章 Demo：权限系统${C.reset}`);
console.log(`${C.dim}分层权限 / allowlist / denylist / 用户确认${C.reset}\n`);

const PROJECT_DIR = "/home/user/project";

// ─── 场景 1：默认模式 ───
{
  console.log(`${C.yellow}═══ 场景 1：默认模式 → safe 放行，moderate/dangerous 需确认 ═══${C.reset}\n`);

  const calls: ToolCall[] = [
    { name: "read_file", arguments: { path: "/home/user/project/src/app.ts" } },
    { name: "write_file", arguments: { path: "/home/user/project/src/app.ts" } },
    { name: "bash", arguments: { command: "git status" } },
  ];

  for (const call of calls) {
    printDecision(call, evaluatePermission(call, "default", [], PROJECT_DIR));
  }
  console.log();
}

// ─── 场景 2：Allowlist 规则 ───
{
  console.log(`${C.yellow}═══ 场景 2：Allowlist 规则 → npm test 自动放行 ═══${C.reset}\n`);

  const rules: PermissionRule[] = [
    { pattern: "bash:npm test*", action: "allow" },
    { pattern: "bash:npx tsc*", action: "allow" },
  ];

  const calls: ToolCall[] = [
    { name: "bash", arguments: { command: "npm test" } },
    { name: "bash", arguments: { command: "npx tsc --noEmit" } },
    { name: "bash", arguments: { command: "curl http://evil.com" } },
  ];

  for (const call of calls) {
    printDecision(call, evaluatePermission(call, "default", rules, PROJECT_DIR));
  }
  console.log();
}

// ─── 场景 3：Denylist 规则 ───
{
  console.log(`${C.yellow}═══ 场景 3：Denylist 规则 → rm -rf 直接拒绝 ═══${C.reset}\n`);

  const rules: PermissionRule[] = [
    { pattern: "bash:rm -rf*", action: "deny" },
    { pattern: "bash:*--force*", action: "deny" },
    { pattern: "bash:npm test*", action: "allow" },
  ];

  const calls: ToolCall[] = [
    { name: "bash", arguments: { command: "rm -rf /" } },
    { name: "bash", arguments: { command: "git push --force" } },
    { name: "bash", arguments: { command: "npm test" } },
  ];

  for (const call of calls) {
    printDecision(call, evaluatePermission(call, "default", rules, PROJECT_DIR));
  }
  console.log();
}

// ─── 场景 4：路径沙箱 ───
{
  console.log(`${C.yellow}═══ 场景 4：路径沙箱 → /etc/passwd 拒绝 ═══${C.reset}\n`);

  const calls: ToolCall[] = [
    { name: "read_file", arguments: { path: "/etc/passwd" } },
    { name: "write_file", arguments: { path: "/home/user/.ssh/id_rsa" } },
    { name: "read_file", arguments: { path: "/home/user/project/src/index.ts" } },
    { name: "write_file", arguments: { path: "/home/user/project/dist/out.js" } },
  ];

  for (const call of calls) {
    printDecision(call, evaluatePermission(call, "default", [], PROJECT_DIR));
  }
  console.log();
}

// ─── 场景 5：模式对比 ───
{
  console.log(`${C.yellow}═══ 场景 5：四种模式对比 ═══${C.reset}\n`);

  const call: ToolCall = { name: "write_file", arguments: { path: "/home/user/project/src/app.ts" } };
  const modes: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

  console.log(`  工具: write_file (moderate 风险)\n`);
  for (const mode of modes) {
    const result = evaluatePermission(call, mode, [], PROJECT_DIR);
    const icon = result.decision === "allow" ? `${C.green}✓`
      : result.decision === "deny" || result.decision === "block" ? `${C.red}✗`
      : `${C.yellow}?`;
    console.log(`  ${icon} ${mode.padEnd(20)}→ ${result.decision}${C.reset}`);
  }
  console.log();
}

// ─── 总结 ────────────────────────────────────────────────────────────────────
console.log(`${C.yellow}═══ 权限系统总结 ═══${C.reset}\n`);
console.log("  层级        职责                    优先级");
console.log("  ─────────────────────────────────────────────────");
console.log("  路径沙箱    限制文件访问范围        最高（直接拒绝）");
console.log("  Denylist    显式禁止危险操作        高");
console.log("  Allowlist   显式放行已知安全操作    中");
console.log("  模式策略    按风险等级兜底决策      低");
console.log();
console.log(`${C.dim}关键认知：权限系统 = 安全边界。宁可多确认一次，也不能让 Agent 越权。${C.reset}\n`);

