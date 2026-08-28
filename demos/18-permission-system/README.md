# 第 18 章 Demo：权限系统

用 ScriptedModel 模拟工具调用，演示分层权限管道的决策流程。无需 API key。

## 运行

```bash
cd demos/18-permission-system
npm install
npx tsx main.ts
```

## 输出示例

```
═══ 场景 1：默认模式 → safe 放行，moderate/dangerous 需确认 ═══

  ✓ ALLOW  read_file: /home/user/project/src/app.ts
  ? CONFIRM  write_file: /home/user/project/src/app.ts
  ? CONFIRM  bash: git status

═══ 场景 2：Allowlist 规则 → npm test 自动放行 ═══

  ✓ ALLOW  bash: npm test
  ✓ ALLOW  bash: npx tsc --noEmit
  ? CONFIRM  bash: curl http://evil.com

═══ 场景 3：Denylist 规则 → rm -rf 直接拒绝 ═══

  ✗ DENY  bash: rm -rf /
  ✗ DENY  bash: git push --force
  ✓ ALLOW  bash: npm test

═══ 场景 4：路径沙箱 → /etc/passwd 拒绝 ═══

  ✗ DENY  read_file: /etc/passwd
  ✗ DENY  write_file: /home/user/.ssh/id_rsa
  ✓ ALLOW  read_file: /home/user/project/src/index.ts
  ? CONFIRM  write_file: /home/user/project/dist/out.js
```

## 学到什么

- 权限系统 = Agent 的安全边界，防止模型越权操作
- 工具按风险分级：safe（读取）/ moderate（写入）/ dangerous（shell）
- 权限管道分层执行：路径沙箱 → Denylist → Allowlist → 模式策略
- 四种模式平衡安全与效率：default（保守）到 bypassPermissions（完全信任）
- Glob 模式让规则既灵活又简洁（如 `bash:npm test*`）
- 路径沙箱是最后一道防线，防止访问项目目录外的文件
