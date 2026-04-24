import { languageLabel, type LlmProvider, type PluginSettings, type PrimaryLanguage } from "./domain";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  max_tokens?: number;
  response_format?: {
    type: "json_object";
  };
}

export interface ResolvedLlmConfig {
  provider: LlmProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  apiKeyRequired: boolean;
}

const providerDefaults: Record<LlmProvider, { endpoint: string; apiKeyRequired: boolean }> = {
  openai: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKeyRequired: true,
  },
  deepseek: {
    endpoint: "https://api.deepseek.com/chat/completions",
    apiKeyRequired: true,
  },
  "openai-compatible": {
    endpoint: "",
    apiKeyRequired: true,
  },
  ollama: {
    endpoint: "http://localhost:11434/v1/chat/completions",
    apiKeyRequired: false,
  },
};

export function normalizeProvider(value: unknown): LlmProvider {
  if (value === "openai" || value === "deepseek" || value === "openai-compatible" || value === "ollama") {
    return value;
  }
  return "openai-compatible";
}

export function resolveLlmConfig(settings: PluginSettings): ResolvedLlmConfig {
  const provider = normalizeProvider(settings.llmProvider);
  const defaults = providerDefaults[provider];
  const configuredEndpoint = settings.llmEndpoint.trim();

  return {
    provider,
    endpoint: normalizeChatCompletionsEndpoint(configuredEndpoint || defaults.endpoint),
    apiKey: settings.llmApiKey.trim(),
    model: settings.llmModel.trim(),
    apiKeyRequired: defaults.apiKeyRequired,
  };
}

export function normalizeChatCompletionsEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return "";

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  if (withoutTrailingSlash.endsWith("/chat/completions")) return withoutTrailingSlash;
  if (withoutTrailingSlash.endsWith("/v1")) return `${withoutTrailingSlash}/chat/completions`;

  try {
    const parsed = new URL(withoutTrailingSlash);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      return `${withoutTrailingSlash}/chat/completions`;
    }
  } catch {
    return withoutTrailingSlash;
  }

  return withoutTrailingSlash;
}

export function validateLlmConfig(config: ResolvedLlmConfig) {
  if (!config.endpoint) {
    throw new Error("Configure LLM endpoint in plugin settings first.");
  }

  if (!config.model) {
    throw new Error("Configure LLM model in plugin settings first.");
  }

  if (config.apiKeyRequired && !config.apiKey) {
    throw new Error("Configure LLM API key in plugin settings first.");
  }
}

export function buildUrlAnalysisMessages(input: {
  url: string;
  title: string;
  text: string;
  primaryLanguage?: PrimaryLanguage;
}): ChatMessage[] {
  const primaryLanguage = input.primaryLanguage ?? "zh";
  const primaryLanguageLabel = languageLabel(primaryLanguage);
  const languageRule =
    primaryLanguage === "zh"
      ? "Use Chinese for sourceTitle, topic, page title, summary, reason, content, and seeAlso, except proper nouns, official names, URLs, direct source titles, and quoted terms that should remain unchanged."
      : "Use English for sourceTitle, topic, page title, summary, reason, content, and seeAlso, except proper nouns, official names, URLs, direct source titles, and quoted terms that should remain unchanged.";

  return [
    {
      role: "system",
      content:
        "You are an LLM Wiki compiler. Analyze web content into durable Logseq wiki notes. Return valid json only. Be concise, preserve source context, and propose useful wikilinks.",
    },
    {
      role: "user",
      content: [
        `URL: ${input.url}`,
        `Title: ${input.title}`,
        `Primary language for compiled wiki output: ${primaryLanguageLabel}`,
        "",
        "Return strict JSON only. Do not wrap it in Markdown fences.",
        "Schema:",
        '{"sourceTitle":"Source title","sourcePublishedDate":"YYYY-MM-DD or Unknown","topic":"one broad topic","pages":[{"title":"Concept or entity page title","topic":"one broad topic","summary":"One-line index summary","reason":"Why this page should be created or updated","content":"Markdown blocks to append to the page. Use [[wikilinks]] where useful.","seeAlso":["Related Page"]}]}',
        "",
        "Karpathy LLM Wiki rules:",
        "- Treat the source as raw immutable material and compile durable wiki pages from it.",
        "- Compile durable concept/entity pages, not a one-off article summary.",
        "- Prefer several focused pages when the source contains distinct reusable concepts.",
        "- If the source updates an existing concept, target the existing concept title.",
        "- If there are conflicting claims, mention the disagreement and source context in content.",
        "- Use Logseq-friendly Markdown and wikilinks. Prefer section headings plus child bullets.",
        "- Do not include source-url/status/confidence metadata in content; the plugin writes metadata.",
        "- Do not propose destructive rewrites.",
        "- The raw source is stored separately in its original language.",
        `- ${languageRule}`,
        "",
        "Content:",
        input.text,
      ].join("\n"),
    },
  ];
}

export function buildLlmRequest(input: {
  model: string;
  url: string;
  title: string;
  text: string;
  primaryLanguage?: PrimaryLanguage;
  enforceJsonMode?: boolean;
}): LlmRequest {
  const request: LlmRequest = {
    model: input.model,
    temperature: 0.2,
    max_tokens: 2048,
    messages: buildUrlAnalysisMessages(input),
  };

  if (input.enforceJsonMode) {
    request.response_format = { type: "json_object" };
  }

  return request;
}

export interface KnowledgeSnippet {
  pageName: string;
  content: string;
}

export function buildKnowledgeChatRequest(input: {
  model: string;
  question: string;
  snippets: KnowledgeSnippet[];
  primaryLanguage?: PrimaryLanguage;
}): LlmRequest {
  const primaryLanguage = input.primaryLanguage ?? "zh";
  const answerLanguage =
    primaryLanguage === "zh"
      ? "Answer in Chinese unless the user's question clearly asks for another language."
      : "Answer in English unless the user's question clearly asks for another language.";
  const context = input.snippets.length
    ? input.snippets.map((snippet, index) => `[${index + 1}] [[${snippet.pageName}]]\n${snippet.content}`).join("\n\n")
    : "No local knowledge snippets were found.";

  return {
    model: input.model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You answer questions using a local Logseq LLM Wiki knowledge base. Ground the answer in the provided snippets, cite page wikilinks, and say when the local knowledge is insufficient.",
      },
      {
        role: "user",
        content: [
          answerLanguage,
          "Use only the local snippets below as factual context. If they are insufficient, say what is missing and do not invent facts.",
          "When useful, cite sources as Logseq wikilinks like [[Page Name]].",
          "",
          "Local snippets:",
          context,
          "",
          `Question: ${input.question}`,
        ].join("\n"),
      },
    ],
  };
}

export function extractChatContent(response: unknown): string {
  const content = (response as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message
    ?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM response did not include message content.");
  }

  return content.trim();
}
