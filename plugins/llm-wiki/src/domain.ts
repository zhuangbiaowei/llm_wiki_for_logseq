export type KnowledgeLayer = "raw" | "wiki" | "output" | "schema" | "unknown";
export type LlmProvider = "openai" | "openai-compatible" | "ollama";
export type PrimaryLanguage = "zh" | "en";

export interface PluginSettings {
  agentsPath: string;
  wikiNamespace: string;
  requireApproval: boolean;
  piiRedaction: boolean;
  primaryLanguage: PrimaryLanguage;
  defaultConfidence: number;
  llmProvider: LlmProvider;
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
}

export interface IngestProposal {
  status: "pending";
  sourceBlockUuid: string;
  sourceUrl?: string;
  targetPage: string;
  summary: string;
  properties: {
    "source-block": string;
    "source-url"?: string;
    "confidence-score": number;
    status: "current";
  };
}

export interface WikiPageDraft {
  title: string;
  content: string;
  reason?: string;
  topic?: string;
  summary?: string;
  seeAlso?: string[];
}

export interface WikiChangePlan {
  sourceUrl: string;
  sourceTitle?: string;
  sourcePublishedDate?: string;
  topic?: string;
  pages: WikiPageDraft[];
}

export type WikiChangeAction = "create" | "update";

export interface WikiPageChange extends WikiPageDraft {
  pageName: string;
  action: WikiChangeAction;
}

export interface WikiChangePreview {
  sourceUrl: string;
  sourceTitle?: string;
  rawPageName: string;
  topic: string;
  changes: WikiPageChange[];
}

export const defaultSettings: PluginSettings = {
  agentsPath: "AGENTS.md",
  wikiNamespace: "",
  requireApproval: true,
  piiRedaction: true,
  primaryLanguage: "zh",
  defaultConfidence: 0.85,
  llmProvider: "openai-compatible",
  llmEndpoint: "",
  llmApiKey: "",
  llmModel: "",
};

export function normalizePrimaryLanguage(value: unknown): PrimaryLanguage {
  return value === "en" ? "en" : "zh";
}

export function languageLabel(language: PrimaryLanguage): string {
  return language === "zh" ? "中文" : "English";
}

export function pathToLayer(path: string): KnowledgeLayer {
  if (path === "AGENTS.md" || path.endsWith("/AGENTS.md")) return "schema";
  if (path.startsWith("journals/")) return "raw";
  if (path.startsWith("pages/writing") || path.startsWith("pages/software")) return "output";
  if (path.startsWith("pages/")) return "wiki";
  return "unknown";
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export function todayIso(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function slugify(input: string): string {
  return normalizeTitle(input)
    .toLowerCase()
    .replace(/[\[\]（）()《》"'“”‘’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "source";
}

export function rawPageName(input: { title: string; date?: string }): string {
  return `llm-wiki/raw/${input.date ?? todayIso()}-${slugify(input.title)}`;
}

export function indexPageName(): string {
  return "llm-wiki/index";
}

export function logPageName(): string {
  return "llm-wiki/log";
}

export function summarizeBlock(content: string): string {
  const cleaned = content
    .replace(/#clippings\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Empty source block.";
  if (cleaned.length <= 280) return cleaned;
  return `${cleaned.slice(0, 277).trim()}...`;
}

export function buildIngestProposal(input: {
  sourceBlockUuid: string;
  content: string;
  suggestedTitle: string;
  sourceUrl?: string;
  settings?: Partial<PluginSettings>;
}): IngestProposal {
  const settings = { ...defaultSettings, ...input.settings };
  const title = normalizeTitle(input.suggestedTitle || "Inbox");

  return {
    status: "pending",
    sourceBlockUuid: input.sourceBlockUuid,
    sourceUrl: input.sourceUrl,
    targetPage: title,
    summary: summarizeBlock(input.content),
    properties: {
      "source-block": input.sourceBlockUuid,
      ...(input.sourceUrl ? { "source-url": input.sourceUrl } : {}),
      "confidence-score": settings.defaultConfidence,
      status: "current",
    },
  };
}

export function buildUrlAnalysisProposal(input: {
  url: string;
  analysis: string;
  title?: string;
  settings?: Partial<PluginSettings>;
}): IngestProposal {
  return buildIngestProposal({
    sourceBlockUuid: `url:${input.url}`,
    sourceUrl: input.url,
    content: input.analysis,
    suggestedTitle: input.title || "Inbox",
    settings: input.settings,
  });
}

export function pageTitleToWikiPage(title: string, _settings?: Partial<PluginSettings>): string {
  return normalizeTitle(title || "Inbox").replace(/^\[\[|\]\]$/g, "");
}

export function normalizeWikiPlan(input: unknown, sourceUrl: string): WikiChangePlan {
  const parsed = typeof input === "string" ? JSON.parse(extractJsonObject(input)) : input;
  const root = parsed as Record<string, unknown>;
  const pages = root.pages;

  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("LLM plan did not include any pages.");
  }

  return {
    sourceUrl,
    sourceTitle: typeof root.sourceTitle === "string" ? normalizeTitle(root.sourceTitle) : undefined,
    sourcePublishedDate: typeof root.sourcePublishedDate === "string" ? normalizeTitle(root.sourcePublishedDate) : undefined,
    topic: typeof root.topic === "string" ? normalizeTitle(root.topic) : undefined,
    pages: pages.map((page, index) => {
      const record = page as Record<string, unknown>;
      const title = typeof record.title === "string" ? normalizeTitle(record.title) : "";
      const content = typeof record.content === "string" ? record.content.trim() : "";
      const reason = typeof record.reason === "string" ? record.reason.trim() : undefined;
      const topic = typeof record.topic === "string" ? normalizeTitle(record.topic) : undefined;
      const summary = typeof record.summary === "string" ? normalizeTitle(record.summary) : undefined;
      const seeAlso = Array.isArray(record.seeAlso)
        ? record.seeAlso.filter((item): item is string => typeof item === "string").map(normalizeTitle)
        : undefined;

      if (!title) throw new Error(`LLM plan page ${index + 1} is missing title.`);
      if (!content) throw new Error(`LLM plan page ${index + 1} is missing content.`);

      return { title, content, reason, topic, summary, seeAlso };
    }),
  };
}

function extractJsonObject(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced || trimmed;

  if (candidate.startsWith("{")) return candidate;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) return candidate.slice(start, end + 1);

  return candidate;
}
