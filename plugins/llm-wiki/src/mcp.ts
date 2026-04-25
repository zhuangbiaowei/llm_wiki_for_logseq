import type { McpServiceConfig } from "./domain";

export interface McpSearchResult {
  serviceId: string;
  serviceName: string;
  title: string;
  url?: string;
  content: string;
}

export interface McpToolSummary {
  name: string;
  description?: string;
}

export interface McpJsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpSseEndpoint {
  endpoint: string;
}

export function parseMcpServices(value: unknown): McpServiceConfig[] {
  if (Array.isArray(value)) return normalizeMcpServices(value);
  if (value && typeof value === "object") return normalizeMcpServices([value]);
  if (typeof value !== "string" || !value.trim() || value === "[object Object]") return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return normalizeMcpServices(parsed);
    if (parsed && typeof parsed === "object") return normalizeMcpServices([parsed]);
    return [];
  } catch {
    return [];
  }
}

export function serializeMcpServices(services: McpServiceConfig[]): string {
  return JSON.stringify(normalizeMcpServices(services), null, 2);
}

export function createMcpService(input: { name: string; url: string; enabled?: boolean }): McpServiceConfig {
  const url = normalizeMcpServiceUrl(input.url);
  const name = input.name.trim() || hostLabel(url);
  return {
    id: stableServiceId(`${name}:${url}`),
    name,
    type: "url",
    url,
    enabled: input.enabled ?? true,
  };
}

export function normalizeMcpServiceUrl(value: string): string {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MCP Service URL must start with http:// or https://.");
  }
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function buildMcpToolsListRequest(id = 1): McpJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/list",
    params: {},
  };
}

export function buildMcpInitializeRequest(id = 1): McpJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "logseq-llm-wiki",
        version: "0.1.0",
      },
    },
  };
}

export function buildMcpInitializedNotification(): Omit<McpJsonRpcRequest, "id"> {
  return {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  };
}

export function buildMcpToolCallRequest(id: number, toolName: string, query: string): McpJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: {
        query,
        q: query,
        text: query,
      },
    },
  };
}

export function chooseSearchTool(tools: McpToolSummary[]): McpToolSummary | null {
  if (!tools.length) return null;
  const scored = tools.map((tool) => {
    const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
    let score = 0;
    if (tool.name === "search") score += 20;
    if (/\bsearch\b/.test(haystack)) score += 12;
    if (/\b(query|find|retrieve|lookup|web_search|knowledge_search)\b/.test(haystack)) score += 6;
    return { tool, score };
  });

  return scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))[0]?.tool ?? null;
}

export function isMcpSseUrl(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").endsWith("/sse");
  } catch {
    return false;
  }
}

export function extractMcpSseEndpoint(sseUrl: string, text: string): McpSseEndpoint | null {
  const base = new URL(sseUrl);
  const events = text.split(/\r?\n\r?\n/);

  for (const eventText of events) {
    const lines = eventText.split(/\r?\n/);
    let eventName = "message";
    const data: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }

    if (eventName === "endpoint" && data.length) {
      return {
        endpoint: new URL(data.join("\n"), base).toString(),
      };
    }
  }

  return null;
}

export function assertMcpSuccess(response: unknown): unknown {
  const record = response as { error?: { message?: unknown; code?: unknown } };
  if (record?.error) {
    const message = typeof record.error.message === "string" ? record.error.message : "MCP request failed.";
    const code = typeof record.error.code === "number" || typeof record.error.code === "string" ? ` (${record.error.code})` : "";
    throw new Error(`${message}${code}`);
  }
  return response;
}

export function extractMcpTools(response: unknown): McpToolSummary[] {
  const tools = (response as { result?: { tools?: unknown } }).result?.tools;
  if (!Array.isArray(tools)) return [];

  return tools
    .map((tool) => {
      const record = tool as Record<string, unknown>;
      return {
        name: typeof record.name === "string" ? record.name : "",
        description: typeof record.description === "string" ? record.description : undefined,
      };
    })
    .filter((tool) => tool.name);
}

export function extractMcpSearchResults(service: McpServiceConfig, response: unknown): McpSearchResult[] {
  const result = (response as { result?: unknown }).result ?? response;
  const candidates = collectResultItems(result);

  return candidates.slice(0, 5).map((item, index) => {
    const title = item.title || item.name || `${service.name} result ${index + 1}`;
    return {
      serviceId: service.id,
      serviceName: service.name,
      title,
      url: item.url,
      content: item.content || item.text || item.summary || item.description || stringifyCompact(item.raw),
    };
  }).filter((item) => item.content.trim());
}

function normalizeMcpServices(value: unknown[]): McpServiceConfig[] {
  const seen = new Set<string>();
  const services: McpServiceConfig[] = [];

  for (const item of value) {
    const record = item as Partial<McpServiceConfig> & Record<string, unknown>;
    const rawUrl = typeof record.url === "string" ? record.url : "";
    if (!rawUrl.trim()) continue;

    try {
      const url = normalizeMcpServiceUrl(rawUrl);
      const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : hostLabel(url);
      const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : stableServiceId(`${name}:${url}`);
      if (seen.has(id)) continue;
      seen.add(id);
      services.push({
        id,
        name,
        type: "url",
        url,
        enabled: record.enabled !== false,
      });
    } catch {
      continue;
    }
  }

  return services;
}

function collectResultItems(value: unknown): Array<{ title?: string; name?: string; url?: string; content?: string; text?: string; summary?: string; description?: string; raw: unknown }> {
  if (typeof value === "string") {
    const parsed = parseEmbeddedJson(value);
    if (parsed) return collectResultItems(parsed);
    return [{ content: value, raw: value }];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectResultItems);
  }

  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const content = record.content;
  if (Array.isArray(content)) {
    return content.flatMap(collectResultItems);
  }

  const nested = record.results ?? record.items ?? record.documents ?? record.data;
  if (Array.isArray(nested)) {
    return nested.flatMap(collectResultItems);
  }

  const text = typeof record.text === "string" ? record.text : undefined;
  const summary = typeof record.summary === "string" ? record.summary : undefined;
  const snippet = typeof record.snippet === "string" ? record.snippet : undefined;
  const description = typeof record.description === "string" ? record.description : undefined;
  const stringContent = typeof content === "string" ? content : undefined;
  const embedded = parseEmbeddedJson(stringContent ?? text ?? "");
  if (embedded) return collectResultItems(embedded);

  return [{
    title: typeof record.title === "string" ? record.title : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
    url: typeof record.url === "string" ? record.url : typeof record.link === "string" ? record.link : undefined,
    content: stringContent,
    text,
    summary: summary ?? snippet,
    description,
    raw: value,
  }];
}

function parseEmbeddedJson(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "MCP Service";
  }
}

function stableServiceId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return `mcp-${Math.abs(hash).toString(36)}`;
}

function stringifyCompact(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
