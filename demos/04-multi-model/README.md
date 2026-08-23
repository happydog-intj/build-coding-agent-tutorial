# 第 04 章 Demo：多模型适配

同一个 `streamSimple()` 调用，切换 model 对象就能调用不同厂商。

## 运行

```bash
cd demos/04-multi-model
npm install

# 单个厂商
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts
OPENAI_API_KEY=sk-xxx npx tsx main.ts --model=gpt-4o

# 对比模式：同时调两家
ANTHROPIC_API_KEY=xxx OPENAI_API_KEY=xxx npx tsx main.ts --compare
```

## 学到什么

- `builtinModels()` 注册 30+ provider 的适配器
- `getBuiltinModel(provider, id)` 返回 Model 元数据对象
- `models.streamSimple(model, context)` 根据 model.provider 自动路由
- Agent Loop 只认识 Context / AssistantMessage，厂商差异止于适配层
- 切换厂商 = 换一个 Model 对象，业务代码零修改
