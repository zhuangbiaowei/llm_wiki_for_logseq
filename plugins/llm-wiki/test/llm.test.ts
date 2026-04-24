import {
  buildKnowledgeChatRequest,
  buildLlmRequest,
  extractChatContent,
  normalizeChatCompletionsEndpoint,
  resolveLlmConfig,
  validateLlmConfig,
} from "../src/llm";
import { defaultSettings } from "../src/domain";

describe("llm helpers", () => {
  it("builds an openai-compatible chat request", () => {
    const request = buildLlmRequest({
      model: "test-model",
      url: "https://example.com",
      title: "Example",
      text: "Article text",
      primaryLanguage: "zh",
    });

    expect(request.model).toBe("test-model");
    expect(request.messages[1].content).toContain("Return strict JSON only");
    expect(request.messages[1].content).toContain("raw immutable material");
    expect(request.messages[1].content).toContain("Primary language for compiled wiki output: 中文");
    expect(request.messages[1].content).toContain("Use Chinese for sourceTitle");
    expect(request.temperature).toBe(0.2);
  });

  it("builds a local knowledge chat request with snippets", () => {
    const request = buildKnowledgeChatRequest({
      model: "test-model",
      question: "北方舰队是什么？",
      snippets: [{ pageName: "北方舰队", content: "- 苏联海军舰队之一" }],
      primaryLanguage: "zh",
    });

    expect(request.model).toBe("test-model");
    expect(request.messages[0].content).toContain("local Logseq LLM Wiki");
    expect(request.messages[1].content).toContain("[[北方舰队]]");
    expect(request.messages[1].content).toContain("北方舰队是什么？");
    expect(request.temperature).toBe(0.2);
  });

  it("extracts chat response content", () => {
    expect(
      extractChatContent({
        choices: [{ message: { content: "Result" } }],
      }),
    ).toBe("Result");
  });

  it("resolves openai provider defaults", () => {
    const config = resolveLlmConfig({
      ...defaultSettings,
      llmProvider: "openai",
      llmEndpoint: "",
      llmApiKey: "key",
      llmModel: "model",
    });

    expect(config.endpoint).toBe("https://api.openai.com/v1/chat/completions");
    expect(config.apiKeyRequired).toBe(true);
  });

  it("allows ollama without api key", () => {
    const config = resolveLlmConfig({
      ...defaultSettings,
      llmProvider: "ollama",
      llmEndpoint: "",
      llmApiKey: "",
      llmModel: "llama3.1",
    });

    expect(() => validateLlmConfig(config)).not.toThrow();
    expect(config.endpoint).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("normalizes v1 base endpoints to chat completions endpoints", () => {
    expect(normalizeChatCompletionsEndpoint("https://api.siliconflow.cn/v1/")).toBe(
      "https://api.siliconflow.cn/v1/chat/completions",
    );
    expect(normalizeChatCompletionsEndpoint("https://api.siliconflow.cn/v1/chat/completions")).toBe(
      "https://api.siliconflow.cn/v1/chat/completions",
    );
  });
});
