# 第 08 章 Demo：Core Tools — 完整 Coding Agent

5 个核心工具的完整 Agent：read_file / write_file / edit_file / search_files / bash。

## 运行

```bash
cd demos/08-core-tools
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts

# 自定义任务
npx tsx main.ts "读取 package.json，告诉我有几个依赖"
npx tsx main.ts "创建 /tmp/fizzbuzz.ts 实现 FizzBuzz 1-20，然后运行"
npx tsx main.ts "搜索所有包含 TODO 的 .ts 文件"
```

## 学到什么

- read_file 带行号 → 方便模型引用代码位置
- write_file 自动 mkdir → 减少模型操作步骤
- edit_file 字符串匹配 → 避免行号漂移问题
- search_files 正则搜索 → 先定位再修改的工作流
- bash timeout + 中间截断 → 防死循环 + 保留首尾有用信息
- 统一错误处理：永远返回 ToolResult，永远不 throw
- 5 个工具 = Coding Agent 的完整操作闭环（search → read → write/edit → bash 验证）
