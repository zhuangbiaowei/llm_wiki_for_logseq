import {
  buildKnowledgeChatRequest,
  buildLlmRequest,
  buildSearchSaveRequest,
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
    expect(request.max_tokens).toBe(2048);
    expect(request.response_format).toBeUndefined();
  });

  it("can enforce json mode for providers that handle it reliably", () => {
    const request = buildLlmRequest({
      model: "test-model",
      url: "https://example.com",
      title: "Example",
      text: "Article text",
      enforceJsonMode: true,
    });

    expect(request.response_format).toEqual({ type: "json_object" });
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
    expect(request.messages[1].content).toContain("MCP search results");
    expect(request.temperature).toBe(0.2);
  });

  it("builds a knowledge chat request with separate MCP search context", () => {
    const request = buildKnowledgeChatRequest({
      model: "test-model",
      question: "What changed?",
      snippets: [{ pageName: "Local Page", content: "Local context" }],
      mcpResults: [{ serviceId: "mcp-1", serviceName: "Web MCP", title: "Remote result", content: "Remote context" }],
      primaryLanguage: "en",
    });

    expect(request.messages[1].content).toContain("Local knowledge snippets");
    expect(request.messages[1].content).toContain("[[Local Page]]");
    expect(request.messages[1].content).toContain("MCP search results");
    expect(request.messages[1].content).toContain("Web MCP / Remote result");
  });

  it("builds a search save request for durable wiki compilation", () => {
    const request = buildSearchSaveRequest({
      model: "test-model",
      question: "保存什么？",
      localSnippets: [{ pageName: "本地页面", content: "- 本地材料" }],
      mcpResults: [{ serviceId: "mcp-1", serviceName: "Search MCP", title: "远程材料", content: "- 远程材料" }],
      primaryLanguage: "zh",
    });

    expect(request.messages[0].content).toContain("LLM Wiki compiler");
    expect(request.messages[1].content).toContain("Return strict JSON only");
    expect(request.messages[1].content).toContain("[[本地页面]]");
    expect(request.messages[1].content).toContain("Search MCP / 远程材料");
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

  it("resolves deepseek provider defaults", () => {
    const config = resolveLlmConfig({
      ...defaultSettings,
      llmProvider: "deepseek",
      llmEndpoint: "",
      llmApiKey: "key",
      llmModel: "deepseek-chat",
    });

    expect(config.endpoint).toBe("https://api.deepseek.com/chat/completions");
    expect(config.apiKeyRequired).toBe(true);
  });

  it("normalizes v1 base endpoints to chat completions endpoints", () => {
    expect(normalizeChatCompletionsEndpoint("https://api.siliconflow.cn/v1/")).toBe(
      "https://api.siliconflow.cn/v1/chat/completions",
    );
    expect(normalizeChatCompletionsEndpoint("https://api.siliconflow.cn/v1/chat/completions")).toBe(
      "https://api.siliconflow.cn/v1/chat/completions",
    );
  });

  it("normalizes bare base URLs to chat completions endpoints", () => {
    expect(normalizeChatCompletionsEndpoint("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    expect(normalizeChatCompletionsEndpoint("https://api.deepseek.com/")).toBe(
      "https://api.deepseek.com/chat/completions",
    );
  });
});
