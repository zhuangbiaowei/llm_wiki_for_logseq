import {
  assertMcpSuccess,
  buildMcpInitializedNotification,
  buildMcpInitializeRequest,
  buildMcpToolCallRequest,
  buildMcpToolsListRequest,
  chooseSearchTool,
  createMcpService,
  extractMcpSseEndpoint,
  extractMcpSearchResults,
  extractMcpTools,
  isMcpSseUrl,
  parseMcpServices,
  serializeMcpServices,
} from "../src/mcp";

describe("mcp helpers", () => {
  it("creates and round-trips URL MCP services", () => {
    const service = createMcpService({
      name: "Search MCP",
      url: "https://example.com/mcp/",
    });

    expect(service.type).toBe("url");
    expect(service.url).toBe("https://example.com/mcp");
    expect(service.enabled).toBe(true);
    expect(parseMcpServices(serializeMcpServices([service]))).toEqual([service]);
  });

  it("ignores invalid service entries", () => {
    expect(parseMcpServices('[{"url":"ftp://example.com"},{"name":"missing"}]')).toEqual([]);
    expect(parseMcpServices("[object Object]")).toEqual([]);
  });

  it("accepts object values from Logseq settings storage", () => {
    const services = parseMcpServices({
      id: "local",
      name: "Local MCP",
      type: "url",
      url: "http://127.0.0.1:3333/mcp",
      enabled: true,
    });

    expect(services).toEqual([
      {
        id: "local",
        name: "Local MCP",
        type: "url",
        url: "http://127.0.0.1:3333/mcp",
        enabled: true,
      },
    ]);
  });

  it("builds MCP JSON-RPC tool requests", () => {
    expect(buildMcpInitializeRequest()).toMatchObject({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
      },
    });
    expect(buildMcpInitializedNotification()).toMatchObject({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(buildMcpToolsListRequest()).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/list",
    });
    expect(buildMcpToolCallRequest(2, "search", "query")).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "search",
        arguments: {
          query: "query",
        },
      },
    });
  });

  it("chooses a search-like tool from tools/list", () => {
    const tools = extractMcpTools({
      result: {
        tools: [
          { name: "summarize", description: "Summarize text" },
          { name: "web_search", description: "Search the web" },
        ],
      },
    });

    expect(chooseSearchTool(tools)?.name).toBe("web_search");
  });

  it("recognizes and parses MCP SSE endpoints", () => {
    expect(isMcpSseUrl("https://example.com/mcp/abc/sse")).toBe(true);
    expect(isMcpSseUrl("https://example.com/mcp/message")).toBe(false);
    expect(
      extractMcpSseEndpoint(
        "https://example.com/mcp/abc/sse",
        "event: endpoint\ndata: /mcp/message?sessionId=123\n\n",
      ),
    ).toEqual({
      endpoint: "https://example.com/mcp/message?sessionId=123",
    });
  });

  it("throws readable MCP JSON-RPC errors", () => {
    expect(() =>
      assertMcpSuccess({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32602, message: "Invalid session ID" },
      }),
    ).toThrow("Invalid session ID (-32602)");
  });

  it("extracts common MCP search result shapes", () => {
    const service = createMcpService({ name: "Search MCP", url: "https://example.com/mcp" });
    const results = extractMcpSearchResults(service, {
      result: {
        content: [
          { title: "Result", url: "https://example.com/a", text: "Body" },
        ],
      },
    });

    expect(results).toEqual([
      {
        serviceId: service.id,
        serviceName: "Search MCP",
        title: "Result",
        url: "https://example.com/a",
        content: "Body",
      },
    ]);
  });

  it("extracts search results embedded as JSON text content", () => {
    const service = createMcpService({ name: "Search MCP", url: "https://example.com/mcp" });
    const results = extractMcpSearchResults(service, {
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify([
              {
                title: "DePHY",
                link: "https://dephy.io/",
                snippet: "Decentralized low-latency off-chain network.",
              },
            ]),
          },
        ],
      },
    });

    expect(results[0]).toMatchObject({
      serviceName: "Search MCP",
      title: "DePHY",
      url: "https://dephy.io/",
      content: "Decentralized low-latency off-chain network.",
    });
  });
});
