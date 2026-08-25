# 第 08 章：核心工具 — read / write / edit / bash / search

> Agent Loop 的骨架有了，但工具还是空的。Coding Agent 最少需要哪些工具？

## 这一章要解决什么问题？

上一章实现了 Agent Loop — 模型可以连续调用工具直到任务完成。但循环里还没有真正有用的工具。一个 Coding Agent 最少需要什么工具才能干活？

答案是五个：**读文件**、**写文件**、**编辑文件**、**执行命令**、**搜索文件**。有了这五个，模型就能定位代码、观察内容、创建文件、修改代码、跑测试。这一章逐个实现它们。

---

## 五工具全景

| 工具 | 职责 | 类比 |
|------|------|------|
| `read_file` | 读取 — 看文件内容 | 打开文件阅读 |
| `write_file` | 创建 — 写入新文件 | 新建文件 |
| `edit_file` | 修改 — 精确替换内容 | 编辑器的查找替换 |
| `bash` | 执行 — 运行 shell 命令 | 终端 |
| `search_files` | 搜索 — 定位代码位置 | 全局搜索 |

这五个覆盖了 Coding Agent 的完整操作闭环：先 search 定位目标，read 看看现状，用 write 创建或 edit 修改，再 bash 运行验证。

---

## read_file：为什么返回带行号的文本？

```typescript
export const readFileTool: MiniTool = {
  name: "read_file",
  description: "Read file contents. Returns line-numbered text. Use offset and limit for large files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to read" },
      offset: { type: "number", description: "Start line number (1-indexed). Default: 1" },
      limit: { type: "number", description: "Max lines to read. Default: all" },
    },
    required: ["path"],
  },
  async execute(params) {
    const filePath = resolve(params.path);

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") return { content: `File not found: ${params.path}`, isError: true };
      if (err.code === "EISDIR") return { content: `Path is a directory: ${params.path}`, isError: true };
      return { content: `Cannot read file: ${err.message}`, isError: true };
    }

    const lines = content.split("\n");
    const offset = Math.max(1, params.offset ?? 1);
    const limit = params.limit ?? lines.length;
    const slice = lines.slice(offset - 1, offset - 1 + limit);

    // 带行号输出
    const numbered = slice.map((line, i) => `${offset + i}\t${line}`).join("\n");
    return { content: `${filePath} (${lines.length} lines)\n${numbered}` };
  },
};
```

两个设计决策：

**为什么带行号？** 模型看到行号后，引用代码时能说"第 42 行的 if 语句"。在 edit_file 定位要修改的位置时，行号也是重要的参考。

**为什么有 offset/limit？** 大文件（几千行）全部读进来会撑爆模型的上下文窗口。让模型可以分段读取 — 先读前 50 行看看结构，再精确读取需要修改的区域。

---

## write_file：自动创建父目录

```typescript
export const writeFileTool: MiniTool = {
  name: "write_file",
  description: "Create or overwrite a file. Automatically creates parent directories.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  },
  async execute(params) {
    const filePath = resolve(params.path);
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, params.content, "utf-8");
    } catch (err: any) {
      return { content: `Failed to write file: ${err.message}`, isError: true };
    }
    const lineCount = params.content.split("\n").length;
    return { content: `Successfully wrote ${lineCount} lines to ${params.path}` };
  },
};
```

**为什么自动 mkdir？** 模型要创建 `src/utils/helper.ts` 时，如果 `src/utils/` 目录不存在，手动让模型先调 `bash mkdir -p src/utils` 再写文件太啰嗦了。自动创建父目录让模型少一步操作，减少出错的机会。

---

## edit_file：为什么用字符串匹配？

```typescript
export const editFileTool: MiniTool = {
  name: "edit_file",
  description: "Edit a file by replacing an exact string match with new content. " +
    "The old_string must match exactly. Use read_file first to see current content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string", description: "Exact string to find and replace" },
      new_string: { type: "string", description: "Replacement string" },
    },
    required: ["path", "old_string", "new_string"],
  },
  async execute(params) {
    const filePath = resolve(params.path);

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") return { content: `File not found: ${params.path}`, isError: true };
      return { content: `Cannot read file: ${err.message}`, isError: true };
    }

    // 精确匹配检查
    const occurrences = content.split(params.old_string).length - 1;

    if (occurrences === 0) {
      const trimmed = params.old_string.trim();
      const fuzzyMatch = content.includes(trimmed);
      let hint = "";
      if (fuzzyMatch) {
        hint = " (A trimmed version was found — check whitespace/indentation.)";
      }
      return { content: `old_string not found in ${params.path}.${hint}`, isError: true };
    }

    if (occurrences > 1) {
      return {
        content: `old_string found ${occurrences} times. It must be unique. Add more context.`,
        isError: true,
      };
    }

    const newContent = content.replace(params.old_string, params.new_string);
    await writeFile(filePath, newContent, "utf-8");
    return { content: `Successfully edited ${params.path}` };
  },
};
```

**为什么不用行号定位？** 假设模型要做两次编辑：先在第 10 行插入一行代码，再修改第 20 行。第一次编辑后，原来的第 20 行变成了第 21 行。行号漂移了。如果模型用行号定位第二次编辑，就会改错地方。

字符串匹配没有这个问题 — 不管前面插了多少行，要找的那段代码内容没变，就能精确定位。

**唯一性校验的意义**：如果 `old_string` 在文件中出现多次，程序不知道该替换哪一个。强制要求唯一，让模型在 old_string 中包含足够的上下文来消歧。

**fuzzy match hint**：如果精确匹配失败但 trim 后能匹配，提示模型"你的缩进或空格有问题"。这帮助模型快速定位错误原因，而不是反复猜。

---

## bash：timeout + 中间截断

```typescript
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 10_000;

export const bashTool: MiniTool = {
  name: "bash",
  description: "Execute a shell command. Returns stdout+stderr. Times out after 30s.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      timeout: { type: "number", description: "Timeout in ms (default: 30000)" },
    },
    required: ["command"],
  },
  async execute(params) {
    const timeout = params.timeout ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve) => {
      exec(params.command, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        let output = stdout + (stderr ? "\n" + stderr : "");

        if (error?.killed) {
          resolve({ content: `Command timed out after ${timeout}ms.`, isError: true });
          return;
        }

        const truncated = truncateOutput(output || "(no output)");
        resolve({ content: truncated, isError: error !== null });
      });
    });
  },
};

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;

  const half = Math.floor(MAX_OUTPUT_CHARS / 2);
  const head = output.slice(0, half);
  const tail = output.slice(-half);
  const omitted = output.length - MAX_OUTPUT_CHARS;

  return `${head}\n\n... (${omitted} characters omitted) ...\n\n${tail}`;
}
```

**为什么要 timeout？** 模型可能运行一个死循环、一个卡住的网络请求、或者一个超慢的构建。30 秒超时保证不会无限等待。

**为什么用中间截断？** 考虑 `npm install` 的输出 — 开头几行显示正在安装什么，结尾几行显示是否成功。中间大量的进度条对模型没用。中间截断保留头尾（最有信息量的部分），砍掉中间的噪音。

对比尾部截断（只保留开头）：模型看不到命令是否成功结束，只能看到一半的输出然后断了。中间截断让模型既能看到命令开头做了什么，又能看到最终结果。

---

## search_files：为什么需要专用搜索工具？

模型在修改代码前需要先**找到**目标。`bash` + `grep` 可以做到，但一个专用的搜索工具让模型更容易正确使用：

```typescript
export const searchFilesTool: MiniTool = {
  name: "search_files",
  description: "Search file contents using regex. Returns matching lines with file paths and line numbers.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: { type: "string", description: "Directory to search in (default: current dir)" },
      include: { type: "string", description: "File glob to include (e.g. '*.ts')" },
    },
    required: ["pattern"],
  },
  async execute(params) {
    const dir = params.path ?? ".";
    const includeFlag = params.include ? `--include='${params.include}'` : "";
    try {
      const output = execSync(
        `grep -rn ${includeFlag} '${params.pattern}' '${dir}' 2>/dev/null | head -50`,
        { encoding: "utf-8", timeout: 10_000 }
      );
      return { content: output || "(no matches)" };
    } catch {
      return { content: "(no matches)" };
    }
  },
};
```

**为什么不让模型直接用 bash + grep？** 四个原因：

- **模型无需记忆 grep 语法** — 参数语义清晰（pattern / path / include），降低出错概率
- **自动限制结果数量** — `head -50` 防止超长输出撑爆上下文窗口
- **安全** — 不需要给模型完整 bash 权限就能搜索
- **工具描述引导工作流** — 模型看到 search_files 的 description 会自然形成"先搜索，再读取，再编辑"的工作模式

搜索工具和 read_file 的 offset/limit 配合使用：先用 search_files 定位到"第 142 行有匹配"，再用 `read_file({ path, offset: 135, limit: 20 })` 读取上下文，最后用 edit_file 精确修改。

---

## 错误处理的统一哲学

四个工具共享同一条规则：**永远返回 ToolResult，永远不 throw。**

```typescript
// 所有工具的错误处理模式
async execute(params) {
  try {
    // 实际操作...
    return { content: "成功结果" };
  } catch (err) {
    return { content: `错误描述: ${err.message}`, isError: true };
  }
}
```

`isError: true` 标记告诉模型"这次调用出了问题"。模型看到错误后自行决定怎么处理：
- `File not found: src/app.ts` → 模型可能调用 bash 运行 `ls src/` 看看有什么文件
- `old_string not found` → 模型可能重新 read_file 看最新内容
- `Command timed out` → 模型可能换一种更快的命令

---

## 工具注册

所有工具通过 `tools/index.ts` 统一导出：

```typescript
import { readFileTool } from "./read.js";
import { writeFileTool } from "./write.js";
import { editFileTool } from "./edit.js";
import { bashTool } from "./bash.js";
import { searchFilesTool } from "./search.js";

export const allTools: MiniTool[] = [readFileTool, writeFileTool, editFileTool, bashTool, searchFilesTool];
```

`allTools` 传给 AgentConfig 的 `tools` 字段，Agent Loop 遍历它来注册工具 schema 和执行工具。添加新工具只需要实现一个 MiniTool 然后加入这个数组。

---

## 章末状态

到这里，我们有了一个完整可用的 Coding Agent：
- Agent Loop 循环引擎（第 07 章）
- 5 个核心工具（本章）
- 流式输出（第 02 章）
- 多模型支持（第 04 章）

你可以让它写一个程序、修改一个文件、跑一个测试。它能自主规划步骤、遇到错误自动调整。接下来要解决的是持久化 — 关掉终端对话就丢了。

---

## 小结

五个工具覆盖了 Coding Agent 的完整操作闭环：search_files 定位目标代码，read_file 带行号返回方便引用和分段读取，write_file 自动创建父目录减少模型操作步骤，edit_file 用字符串精确匹配避免行号漂移问题，bash 用 timeout 防死循环加中间截断保留有用信息。所有工具共享同一条错误处理原则 — 永远返回 ToolResult 而不 throw，让模型有机会自行修正。

---

## 下一章

Agent 能干活了，但关掉终端对话就没了。下一章实现会话持久化 — 用 JSONL 格式逐条追加保存消息，崩溃也不会丢数据。

→ [第 09 章：会话持久化 — JSONL 崩溃安全存储](./09-session-persistence.md)
