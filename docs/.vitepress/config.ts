import { defineConfig } from "vitepress";

const isVercel = !!process.env.VERCEL;
const SITE_URL = isVercel
  ? "https://build-coding-agent-tutorial.vercel.app"
  : "https://happydog-intj.github.io/build-coding-agent-tutorial";
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export default defineConfig({
  title: "从零构建 Coding Agent",
  description:
    "18 章渐进式教程，从 30 行调用一次 LLM 到 750 行完整 Coding Agent。学习 Agent Loop、Tool Use、上下文管理等核心原理。",
  lang: "zh-CN",
  base: isVercel ? "/" : "/build-coding-agent-tutorial/",

  sitemap: {
    hostname: isVercel
      ? "https://build-coding-agent-tutorial.vercel.app"
      : "https://happydog-intj.github.io",
    transformItems(items) {
      if (isVercel) return items;
      return items.map((item) => ({
        ...item,
        url: `build-coding-agent-tutorial/${item.url}`,
      }));
    },
  },

  head: [
    // Open Graph
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:locale", content: "zh_CN" }],
    ["meta", { property: "og:site_name", content: "从零构建 Coding Agent" }],
    ["meta", { property: "og:image", content: OG_IMAGE }],
    [
      "meta",
      {
        property: "og:description",
        content:
          "18 章渐进式 TypeScript 教程，从零实现一个能读文件、写代码、跑测试的 AI Coding Agent",
      },
    ],
    // Twitter Card
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: OG_IMAGE }],
    // SEO
    [
      "meta",
      {
        name: "keywords",
        content:
          "Coding Agent,AI Agent,LLM,Agent Loop,Tool Use,Claude Code,Cursor,TypeScript,教程,从零构建",
      },
    ],
    ["meta", { name: "author", content: "happydog-intj" }],
    // JSON-LD structured data
    [
      "script",
      { type: "application/ld+json" },
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Course",
        name: "从零构建 Coding Agent",
        description:
          "18 章渐进式 TypeScript 教程，从 30 行调用 LLM 到 750 行完整 Coding Agent",
        provider: {
          "@type": "Organization",
          name: "happydog-intj",
          url: "https://github.com/happydog-intj",
        },
        educationalLevel: "Intermediate",
        programmingLanguage: "TypeScript",
        inLanguage: "zh-CN",
        isAccessibleForFree: true,
        url: SITE_URL,
        numberOfCredits: 18,
        hasCourseInstance: {
          "@type": "CourseInstance",
          courseMode: "online",
          courseWorkload: "PT20H",
        },
      }),
    ],
  ],

  themeConfig: {
    nav: [
      { text: "教程", link: "/tutorials/00-observe-full-run" },
      { text: "Demo", link: "/demos" },
      { text: "FAQ", link: "/faq" },
      {
        text: "GitHub",
        link: "https://github.com/happydog-intj/build-coding-agent-tutorial",
      },
    ],

    sidebar: [
      {
        text: "Part 0 · 序章",
        items: [
          {
            text: "00. 观察一次完整的 Agent 运行",
            link: "/tutorials/00-observe-full-run",
          },
        ],
      },
      {
        text: "Part I · 模型与协议",
        items: [
          { text: "01. Hello LLM", link: "/tutorials/01-hello-llm" },
          {
            text: "02. EventStream 事件流",
            link: "/tutorials/02-event-stream",
          },
          { text: "03. 多轮对话", link: "/tutorials/03-multi-turn" },
          {
            text: "04. 多模型适配",
            link: "/tutorials/04-multi-model-adapter",
          },
          { text: "05. 模拟测试", link: "/tutorials/05-mock-testing" },
        ],
      },
      {
        text: "Part II · 工具与循环",
        items: [
          { text: "06. Tool Use 工具调用", link: "/tutorials/06-tool-use" },
          {
            text: "07. Agent Loop 循环引擎",
            link: "/tutorials/07-agent-loop",
          },
          { text: "08. 核心工具", link: "/tutorials/08-core-tools" },
        ],
      },
      {
        text: "Part III · 持久与可靠",
        items: [
          {
            text: "09. 会话持久化",
            link: "/tutorials/09-session-persistence",
          },
          { text: "10. 有状态 Agent", link: "/tutorials/10-stateful-agent" },
          { text: "11. 会话树", link: "/tutorials/11-session-tree" },
          {
            text: "12. 上下文窗口管理",
            link: "/tutorials/12-context-management",
          },
        ],
      },
      {
        text: "Part IV · 扩展与验证",
        items: [
          {
            text: "13. 扩展系统",
            link: "/tutorials/13-extension-system",
          },
          { text: "14. 打磨", link: "/tutorials/14-polish" },
          { text: "15. 评测", link: "/tutorials/15-evaluation" },
          {
            text: "16. System Prompt 工程",
            link: "/tutorials/16-system-prompt-engineering",
          },
          { text: "17. Harness 工程", link: "/tutorials/17-harness" },
        ],
      },
      {
        text: "附录",
        items: [
          { text: "推荐阅读", link: "/tutorials/18-further-reading" },
          { text: "FAQ", link: "/faq" },
        ],
      },
    ],

    outline: { level: [2, 3], label: "目录" },
    search: { provider: "local" },
    lastUpdated: { text: "最后更新" },
    docFooter: { prev: "上一章", next: "下一章" },
  },
});
