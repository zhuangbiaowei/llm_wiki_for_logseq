import "@logseq/libs";
import type { BlockEntity, PageEntity, SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";
import { appendMetadataBlocks, markdownToBlocks, type BatchBlock } from "./blocks";
import {
  buildIngestProposal,
  defaultSettings,
  indexPageName,
  logPageName,
  normalizePrimaryLanguage,
  normalizeWikiPlan,
  pageTitleToWikiPage,
  rawPageName,
  todayIso,
  type PluginSettings,
  type WikiChangePreview,
} from "./domain";
import {
  buildKnowledgeChatRequest,
  buildSearchSaveRequest,
  buildLlmRequest,
  extractChatContent,
  resolveLlmConfig,
  validateLlmConfig,
  type KnowledgeSnippet,
} from "./llm";
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
  type McpSearchResult,
} from "./mcp";
import { redact } from "./redaction";
import { cleanRawSourceText, extractReadableText, extractTitle, limitText, normalizeHttpUrl, type DownloadedPage } from "./web";

const settingsSchema: SettingSchemaDesc[] = [
  {
    key: "agentsPath",
    type: "string",
    title: "AGENTS.md path",
    description: "Path to the LLM Wiki constitution file.",
    default: defaultSettings.agentsPath,
  },
  {
    key: "wikiNamespace",
    type: "string",
    title: "Wiki namespace",
    description: "Namespace used for compiled Wiki pages.",
    default: defaultSettings.wikiNamespace,
  },
  {
    key: "requireApproval",
    type: "boolean",
    title: "Require approval before writes",
    description: "Preview ingest writes before changing the graph.",
    default: defaultSettings.requireApproval,
  },
  {
    key: "piiRedaction",
    type: "boolean",
    title: "Redact secrets and PII",
    description: "Remove obvious emails and API-key-like values before processing.",
    default: defaultSettings.piiRedaction,
  },
  {
    key: "primaryLanguage",
    type: "enum",
    title: "主语言 / Primary language",
    description: "Language for compiled wiki pages, index, log, and journal entries. Raw source keeps its original language.",
    enumChoices: ["zh", "en"],
    enumPicker: "select",
    default: defaultSettings.primaryLanguage,
  },
  {
    key: "llmProvider",
    type: "enum",
    title: "LLM provider",
    description: "Provider preset for endpoint and authentication behavior.",
    enumChoices: ["openai", "deepseek", "openai-compatible", "ollama"],
    enumPicker: "select",
    default: defaultSettings.llmProvider,
  },
  {
    key: "llmEndpoint",
    type: "string",
    title: "LLM endpoint",
    description: "Optional override for the provider chat completions endpoint.",
    default: defaultSettings.llmEndpoint,
  },
  {
    key: "llmApiKey",
    type: "string",
    title: "LLM API key",
    description: "Bearer token used for the LLM endpoint.",
    default: defaultSettings.llmApiKey,
  },
  {
    key: "llmModel",
    type: "string",
    title: "LLM model",
    description: "Model name sent to the chat completions endpoint.",
    default: defaultSettings.llmModel,
  },
  {
    key: "mcpServicesHelp",
    type: "heading",
    title: "MCP Services",
    description: "Open the LLM Wiki toolbar menu and choose MCP服务管理 to add, enable, disable, or delete URL-type MCP services. The service list is managed by the plugin UI, not by editing JSON here.",
    default: null,
  },
];

let currentProposal: ReturnType<typeof buildIngestProposal> | null = null;
let currentPreview: WikiChangePreview | null = null;
let currentDownloadedPage: DownloadedPage | null = null;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  localSources?: string[];
  mcpSources?: string[];
}

let currentChatTurns: ChatTurn[] = [];
let activeMcpServiceIds = new Set<string>();
let lastChatSearchContext: {
  question: string;
  localSnippets: KnowledgeSnippet[];
  mcpResults: McpSearchResult[];
} | null = null;

function currentSettings(): PluginSettings {
  const configured = (logseq.settings ?? {}) as Partial<PluginSettings>;
  return {
    ...defaultSettings,
    agentsPath: String(configured.agentsPath ?? defaultSettings.agentsPath),
    wikiNamespace: String(configured.wikiNamespace ?? defaultSettings.wikiNamespace),
    requireApproval: configured.requireApproval !== false,
    piiRedaction: configured.piiRedaction !== false,
    primaryLanguage: normalizePrimaryLanguage(configured.primaryLanguage),
    llmProvider:
      configured.llmProvider === "openai" ||
      configured.llmProvider === "deepseek" ||
      configured.llmProvider === "openai-compatible" ||
      configured.llmProvider === "ollama"
        ? configured.llmProvider
        : defaultSettings.llmProvider,
    llmEndpoint: String(configured.llmEndpoint ?? defaultSettings.llmEndpoint),
    llmApiKey: String(configured.llmApiKey ?? defaultSettings.llmApiKey),
    llmModel: String(configured.llmModel ?? defaultSettings.llmModel),
    mcpServices: configured.mcpServices ?? defaultSettings.mcpServices,
  };
}

function modalTemplate(proposal: ReturnType<typeof buildIngestProposal>): string {
  return `
    <div class="llm-wiki-modal">
      <header>
        <strong>LLM Wiki Ingest</strong>
        <button data-on-click="closeIngestModal" aria-label="Close">x</button>
      </header>
      <section>
        <div class="llm-wiki-label">Target</div>
        <div class="llm-wiki-target">[[${proposal.targetPage}]]</div>
      </section>
      <section>
        <div class="llm-wiki-label">Compiled Summary</div>
        <p>${escapeHtml(proposal.summary)}</p>
      </section>
      <footer>
        <button data-on-click="approveIngest">Approve</button>
        <button data-on-click="closeIngestModal">Cancel</button>
      </footer>
    </div>
  `;
}

function wikiPreviewTemplate(preview: WikiChangePreview): string {
  const rows = preview.changes
    .map(
      (change) => `
        <li>
          <strong>${change.action === "create" ? "新增" : "修改"}</strong>
          [[${escapeHtml(change.pageName)}]]
          ${change.reason ? `<div class="llm-wiki-help">${escapeHtml(change.reason)}</div>` : ""}
        </li>
      `,
    )
    .join("");

  return `
    <div class="llm-wiki-modal llm-wiki-modal-wide">
      <header>
        <strong>LLM Wiki Plan</strong>
        <button data-on-click="closeIngestModal" aria-label="Close">x</button>
      </header>
      <section>
        <div class="llm-wiki-label">Raw Source</div>
        <div class="llm-wiki-target">[[${escapeHtml(preview.rawPageName)}]]</div>
      </section>
      <section>
        <div class="llm-wiki-label">Source URL</div>
        <div class="llm-wiki-target">${escapeHtml(preview.sourceUrl)}</div>
      </section>
      <section>
        <div class="llm-wiki-label">Planned Page Changes</div>
        <ul class="llm-wiki-change-list">${rows}</ul>
      </section>
      <footer>
        <button data-on-click="approveWikiPlan">Apply Plan</button>
        <button data-on-click="closeIngestModal">Cancel</button>
      </footer>
    </div>
  `;
}

function urlDialogTemplate(): string {
  return `
    <div class="llm-wiki-modal">
      <header>
        <strong>Analyze URL</strong>
        <button data-on-click="closeIngestModal" aria-label="Close">x</button>
      </header>
      <section>
        <label class="llm-wiki-label" for="llm-wiki-url-input">URL</label>
        <input id="llm-wiki-url-input" class="llm-wiki-input" type="url" placeholder="https://example.com/article" autofocus />
        <div class="llm-wiki-help">The plugin will download the page, send readable text to the configured LLM, then preview the Wiki entry.</div>
      </section>
      <footer>
        <button data-on-click="analyzeUrlFromDialog">Analyze</button>
        <button data-on-click="closeIngestModal">Cancel</button>
      </footer>
    </div>
  `;
}

function toolbarMenuTemplate(position: { left: number; top: number }): string {
  const text = uiText();
  return `
    <nav class="llm-wiki-floating-menu" style="left: ${position.left}px; top: ${position.top}px;" aria-label="LLM Wiki menu">
      <button data-on-click="openUrlDialog">${text.openUrl}</button>
      <button data-on-click="openKnowledgeChatDialog">${text.knowledgeChatTitle}</button>
      <button data-on-click="openMcpManagerDialog">${text.mcpManagerTitle}</button>
      <button data-on-click="togglePrimaryLanguage">${text.toggleLanguage}</button>
    </nav>
  `;
}

function mcpManagerTemplate(services = parseMcpServices(currentSettings().mcpServices)): string {
  const text = uiText();
  const rows = services.length
    ? services
        .map(
          (service) => `
            <li class="llm-wiki-mcp-row">
              <div>
                <strong>${escapeHtml(service.name)}</strong>
                <div class="llm-wiki-mcp-url">${escapeHtml(service.url)}</div>
              </div>
              <div class="llm-wiki-mcp-actions">
                <button data-on-click="toggleMcpService" data-service-id="${escapeHtml(service.id)}">${service.enabled ? text.disable : text.enable}</button>
                <button data-on-click="deleteMcpService" data-service-id="${escapeHtml(service.id)}">${text.delete}</button>
              </div>
            </li>
          `,
        )
        .join("")
    : `<li class="llm-wiki-chat-empty">${text.noMcpServices}</li>`;

  return `
    <div class="llm-wiki-modal llm-wiki-modal-wide">
      <header>
        <strong>${text.mcpManagerTitle}</strong>
        <button data-on-click="closeIngestModal" aria-label="Close">x</button>
      </header>
      <section>
        <div class="llm-wiki-mcp-form">
          <input id="llm-wiki-mcp-name-input" class="llm-wiki-input" type="text" placeholder="${text.mcpNamePlaceholder}" />
          <input id="llm-wiki-mcp-url-input" class="llm-wiki-input" type="url" placeholder="${text.mcpUrlPlaceholder}" />
          <button data-on-click="addMcpService">${text.add}</button>
        </div>
        <div class="llm-wiki-help">${text.mcpManagerHelp}</div>
      </section>
      <section>
        <ul class="llm-wiki-mcp-list">${rows}</ul>
      </section>
    </div>
  `;
}

function chatDialogTemplate(turns: ChatTurn[], isLoading = false): string {
  const text = uiText();
  const mcpServices = parseMcpServices(currentSettings().mcpServices).filter((service) => service.enabled);
  const mcpControls = mcpServices.length
    ? mcpServices
        .map((service) => {
          const active = activeMcpServiceIds.has(service.id);
          return `<button class="llm-wiki-mcp-toggle ${active ? "is-active" : ""}" data-on-click="toggleChatMcpService" data-service-id="${escapeHtml(service.id)}">${active ? text.close : text.open} ${escapeHtml(service.name)}</button>`;
        })
        .join("")
    : `<span class="llm-wiki-help">${text.noEnabledMcpServices}</span>`;
  const messages = turns.length
    ? turns
        .map((turn) => {
          const localSources = turn.localSources?.length
            ? `<div class="llm-wiki-chat-sources"><strong>${text.localKnowledgeLabel}:</strong> ${turn.localSources.map((source) => `[[${escapeHtml(source)}]]`).join(", ")}</div>`
            : "";
          const mcpSources = turn.mcpSources?.length
            ? `<div class="llm-wiki-chat-sources"><strong>MCP Search:</strong> ${turn.mcpSources.map(escapeHtml).join(", ")}</div>`
            : "";
          return `
            <article class="llm-wiki-chat-message llm-wiki-chat-message-${turn.role}">
              <div class="llm-wiki-chat-role">${turn.role === "user" ? text.userRole : "LLM Wiki"}</div>
              <div class="llm-wiki-chat-content">${escapeHtml(turn.content).replace(/\n/g, "<br />")}</div>
              ${localSources}
              ${mcpSources}
            </article>
          `;
        })
        .join("")
    : `<div class="llm-wiki-chat-empty">${text.chatEmpty}</div>`;

  return `
    <div class="llm-wiki-modal llm-wiki-chat-modal">
      <header>
        <strong>${text.knowledgeChatTitle}</strong>
        <button data-on-click="closeIngestModal" aria-label="Close">x</button>
      </header>
      <section class="llm-wiki-mcp-chat-bar">
        ${mcpControls}
      </section>
      <section class="llm-wiki-chat-log" aria-live="polite">
        ${messages}
        ${isLoading ? `<div class="llm-wiki-chat-loading">${text.chatLoading}</div>` : ""}
      </section>
      <footer class="llm-wiki-chat-form">
        <textarea id="llm-wiki-chat-input" class="llm-wiki-input llm-wiki-chat-input" rows="3" placeholder="${text.chatPlaceholder}" ${isLoading ? "disabled" : ""}></textarea>
        <button data-on-click="askKnowledgeBase" ${isLoading ? "disabled" : ""}>${text.send}</button>
      </footer>
      <div class="llm-wiki-help">${text.chatHelp}</div>
    </div>
  `;
}

function uiText(settings = currentSettings()) {
  const zh = settings.primaryLanguage === "zh";
  return {
    add: zh ? "添加" : "Add",
    availableMcpTools: zh ? "可用工具" : "Available tools",
    chatEmpty: zh ? "请输入问题。LLM Wiki 会检索本地知识库页面，并结合上下文回答。" : "Ask a question. LLM Wiki will retrieve local knowledge pages and answer from that context.",
    chatHelp: zh ? "回答会区分本地 Logseq 页面与已打开的 MCP Search 服务。输入 /save 可整理并保存上一轮搜索上下文。" : "Answers distinguish local Logseq pages from opened MCP Search services. Type /save to organize and save the previous search context.",
    chatLoading: zh ? "正在检索本地知识库和 MCP 搜索结果，并请求已配置的 LLM..." : "Retrieving local knowledge, MCP search results, and asking the configured LLM...",
    chatPlaceholder: zh ? "输入你的问题，或输入 /save 保存上一轮搜索内容..." : "Enter your question, or type /save to save the previous search context...",
    close: zh ? "关闭" : "Close",
    delete: zh ? "删除" : "Delete",
    disable: zh ? "禁用" : "Disable",
    enable: zh ? "启用" : "Enable",
    enterQuestionFirst: zh ? "请先输入问题。" : "Enter a question first.",
    errorPrefix: zh ? "错误" : "Error",
    localKnowledgeLabel: zh ? "本地知识库" : "Local knowledge",
    mcpManagerHelp: zh ? "仅保存 URL 类型 MCP 服务。聊天窗口中可以按需打开已启用的服务。" : "Only URL-type MCP services are saved. Enabled services can be opened from the chat window as needed.",
    mcpManagerTitle: zh ? "MCP 服务管理" : "MCP Service Manager",
    mcpNamePlaceholder: zh ? "服务名称，例如 Exa Search" : "Service name, for example Exa Search",
    mcpUrlPlaceholder: zh ? "MCP URL，例如 https://example.com/mcp" : "MCP URL, for example https://example.com/mcp",
    noEnabledMcpServices: zh ? "没有已启用的 MCP 服务。" : "No enabled MCP services.",
    noMcpServices: zh ? "还没有 MCP 服务。" : "No MCP services yet.",
    noPreviousSearchContext: zh ? "没有可保存的上一轮搜索上下文。" : "No previous search context to save.",
    noSearchToolContent: zh ? "这个 MCP 服务没有暴露可用于搜索的工具。" : "This MCP service did not expose a search-like tool.",
    noSearchToolTitle: zh ? "没有搜索工具" : "No search tool",
    mcpSearchErrorTitle: zh ? "MCP 搜索错误" : "MCP Search error",
    open: zh ? "打开" : "Open",
    openUrl: zh ? "输入 URL" : "Enter URL",
    knowledgeChatTitle: zh ? "对话知识库" : "Knowledge Chat",
    send: zh ? "发送" : "Send",
    savedSearchContext: zh ? "已将上一轮搜索内容整理并保存到本地知识库。" : "The previous search context has been organized and saved to the local knowledge base.",
    savedSearchContextFallback: zh
      ? "LLM 未返回可用整理结果，已改为保存上一轮搜索上下文。"
      : "The LLM did not return a usable compilation, so the previous search context was saved instead.",
    toggleLanguage: zh ? "切换设置语言" : "Switch language",
    userRole: zh ? "你" : "You",
  };
}

function statusTemplate(title: string, detail: string): string {
  return `
    <div class="llm-wiki-modal">
      <header>
        <strong>${escapeHtml(title)}</strong>
        <button data-on-click="closeIngestModal" aria-label="Close">x</button>
      </header>
      <section>
        <div class="llm-wiki-status">${escapeHtml(detail)}</div>
      </section>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMainUi(template: string, rootClass = "") {
  const app = document.querySelector("#app");
  if (!app) {
    logseq.hideMainUI();
    void logseq.UI.showMsg("LLM Wiki UI container was not found.", "error");
    return;
  }

  logseq.setMainUIAttrs({
    style: {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      zIndex: "999",
    },
  });
  app.innerHTML = `<main id="logseq-llm-wiki-root" class="${rootClass}">${template}</main>`;
  bindMainUiHandlers();
  logseq.showMainUI({ autoFocus: true });
  document.querySelector<HTMLInputElement>("#llm-wiki-url-input")?.focus();
  document.querySelector<HTMLTextAreaElement>("#llm-wiki-chat-input")?.focus();
}

function closeMainUi() {
  const app = document.querySelector("#app");
  if (app) app.innerHTML = "";
  document.onkeydown = null;
  logseq.hideMainUI();
}

function bindMainUiHandlers() {
  const root = document.querySelector("#logseq-llm-wiki-root");
  if (!root) return;

  root.addEventListener("click", (event) => {
    if (event.target === root) {
      closeMainUi();
      return;
    }

    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-on-click]")?.dataset.onClick;
    if (action === "closeIngestModal") closeMainUi();
    if (action === "openUrlDialog") openUrlDialog();
    if (action === "openKnowledgeChatDialog") openKnowledgeChatDialog();
    if (action === "openMcpManagerDialog") openMcpManagerDialog();
    if (action === "addMcpService") void addMcpServiceFromDialog();
    if (action === "toggleMcpService") void toggleMcpServiceFromDialog(event);
    if (action === "deleteMcpService") void deleteMcpServiceFromDialog(event);
    if (action === "toggleChatMcpService") toggleChatMcpService(event);
    if (action === "togglePrimaryLanguage") {
      void togglePrimaryLanguage();
      closeMainUi();
    }
    if (action === "analyzeUrlFromDialog") void analyzeUrlFromDialog();
    if (action === "askKnowledgeBase") void askKnowledgeBaseFromDialog();
    if (action === "approveIngest") void approveCurrentProposal();
    if (action === "approveWikiPlan") void approveCurrentWikiPlan();
  });

  document.onkeydown = (event) => {
    if (event.key === "Escape") closeMainUi();
    if (event.key === "Enter" && document.activeElement?.id === "llm-wiki-url-input") {
      void analyzeUrlFromDialog();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && document.activeElement?.id === "llm-wiki-chat-input") {
      void askKnowledgeBaseFromDialog();
    }
  };
}

async function writeProposal(proposal: ReturnType<typeof buildIngestProposal>) {
  const pageName = proposal.targetPage;
  const content = [
    proposal.summary,
    `source-block:: ${proposal.properties["source-block"]}`,
    ...(proposal.properties["source-url"] ? [`source-url:: ${proposal.properties["source-url"]}`] : []),
    `confidence-score:: ${proposal.properties["confidence-score"]}`,
    `status:: ${proposal.properties.status}`,
  ].join("\n");

  const page = await logseq.Editor.getPage(pageName);
  if (!page) {
    await logseq.Editor.createPage(pageName, {}, { redirect: false, createFirstBlock: false });
  }

  await appendMarkdownBlocksToPage(pageName, content);
  await logseq.UI.showMsg(`LLM Wiki updated: [[${pageName}]]`, "success");
}

function formatJournalPageName(date = new Date()): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";

  return `${months[date.getMonth()]} ${day}${suffix}, ${date.getFullYear()}`;
}

async function appendJournalLog(preview: WikiChangePreview, settings: PluginSettings) {
  const journalName = formatJournalPageName();
  const page = await logseq.Editor.getPage(journalName);
  if (!page) {
    await logseq.Editor.createPage(journalName, {}, { redirect: false, journal: true });
  }

  const parent = await logseq.Editor.appendBlockInPage(journalName, preview.sourceUrl);
  if (!parent) throw new Error("Failed to write journal URL log block.");

  for (const change of preview.changes) {
    const action = settings.primaryLanguage === "zh"
      ? change.action === "create"
        ? "新增"
        : "修改"
      : change.action === "create"
        ? "Created"
        : "Updated";
    await logseq.Editor.insertBlock(parent.uuid, `${action} [[${change.pageName}]]`, {
      sibling: false,
    });
  }
}

async function ensurePage(pageName: string, properties: Record<string, string | number | boolean> = {}) {
  const page = await logseq.Editor.getPage(pageName);
  if (!page) {
    await logseq.Editor.createPage(pageName, properties, {
      redirect: false,
      createFirstBlock: false,
    });
  }
}

async function writeRawSourcePage(page: DownloadedPage, preview: WikiChangePreview) {
  await ensurePage(preview.rawPageName, {
    "knowledge-layer": "raw",
    "source-url": page.url,
    collected: todayIso(),
    published: "Unknown",
  });

  const rawBlocks = markdownToBlocks(
    [`Source: ${page.url}`, `Collected: ${todayIso()}`, "Published: Unknown", "", limitText(cleanRawSourceText(page.text), 20000)].join("\n"),
  );

  await appendBlocksToPage(preview.rawPageName, rawBlocks);
}

async function updateIndexPage(preview: WikiChangePreview, settings: PluginSettings) {
  await ensurePage(indexPageName(), {
    "knowledge-layer": "spine",
  });

  const ingestLabel = settings.primaryLanguage === "zh" ? "摄入" : "ingest";
  const noSummary = settings.primaryLanguage === "zh" ? "(无摘要)" : "(no summary)";
  const parent = await logseq.Editor.appendBlockInPage(indexPageName(), `${todayIso()} ${ingestLabel} | ${preview.topic}`);
  if (!parent) throw new Error("Failed to update LLM Wiki index.");

  for (const change of preview.changes) {
    await logseq.Editor.insertBlock(
      parent.uuid,
      `[[${change.pageName}]] | ${change.summary || change.reason || noSummary} | ${todayIso()}`,
      { sibling: false },
    );
  }
}

async function appendWikiLog(preview: WikiChangePreview, settings: PluginSettings) {
  await ensurePage(logPageName(), {
    "knowledge-layer": "spine",
  });

  const isZh = settings.primaryLanguage === "zh";
  const parent = await logseq.Editor.appendBlockInPage(
    logPageName(),
    `${todayIso()} ${isZh ? "摄入" : "ingest"} | ${preview.changes[0]?.pageName ?? preview.sourceUrl}`,
  );
  if (!parent) throw new Error("Failed to append LLM Wiki log.");

  await logseq.Editor.insertBlock(parent.uuid, `${isZh ? "原始素材" : "Raw"}: [[${preview.rawPageName}]]`, { sibling: false });
  for (const change of preview.changes) {
    const action = isZh
      ? change.action === "create"
        ? "新增"
        : "更新"
      : change.action === "create"
        ? "Created"
        : "Updated";
    await logseq.Editor.insertBlock(parent.uuid, `${action}: [[${change.pageName}]]`, {
      sibling: false,
    });
  }
}

async function buildWikiPreview(planText: string, sourceUrl: string, settings: PluginSettings): Promise<WikiChangePreview> {
  const plan = normalizeWikiPlan(planText, sourceUrl);
  const topic = plan.topic || plan.pages[0]?.topic || "general";
  const rawName = rawPageName({ title: plan.sourceTitle || sourceUrl });
  const changes = await Promise.all(
    plan.pages.map(async (page) => {
      const pageName = pageTitleToWikiPage(page.title, settings);
      const existing = await logseq.Editor.getPage(pageName);

      return {
        ...page,
        pageName,
        action: existing ? ("update" as const) : ("create" as const),
      };
    }),
  );

  return {
    sourceUrl,
    sourceTitle: plan.sourceTitle,
    rawPageName: rawName,
    topic,
    changes,
  };
}

async function applyWikiPreview(preview: WikiChangePreview) {
  const settings = currentSettings();
  if (currentDownloadedPage) {
    await writeRawSourcePage(currentDownloadedPage, preview);
  }

  for (const change of preview.changes) {
    await ensurePage(change.pageName, {
      "knowledge-layer": "wiki",
      topic: change.topic || preview.topic,
    });

    const blocks = appendMetadataBlocks(markdownToBlocks(change.content), {
      "source-url": preview.sourceUrl,
      raw: `[[${preview.rawPageName}]]`,
      "confidence-score": settings.defaultConfidence,
      status: "current",
    });

    await appendBlocksToPage(change.pageName, blocks);
  }

  await updateIndexPage(preview, settings);
  await appendWikiLog(preview, settings);
  await appendJournalLog(preview, settings);
  await logseq.UI.showMsg(`LLM Wiki updated ${preview.changes.length} page(s).`, "success");
}

async function appendMarkdownBlocksToPage(pageName: string, markdown: string) {
  await appendBlocksToPage(pageName, markdownToBlocks(markdown));
}

async function appendBlocksToPage(pageName: string, blocks: BatchBlock[]) {
  if (blocks.length === 0) return;

  for (const block of blocks) {
    const root = await logseq.Editor.appendBlockInPage(pageName, block.content, {
      properties: block.properties ?? {},
    });
    if (!root) throw new Error(`Failed to append block to [[${pageName}]].`);

    if (block.children?.length) {
      await logseq.Editor.insertBatchBlock(root.uuid, block.children, { sibling: false });
    }
  }
}

async function approveCurrentProposal() {
  if (!currentProposal) {
    await logseq.UI.showMsg("No pending LLM Wiki proposal.", "warning");
    return;
  }

  await writeProposal(currentProposal);
  currentProposal = null;
  closeMainUi();
}

async function approveCurrentWikiPlan() {
  if (!currentPreview) {
    await logseq.UI.showMsg("No pending LLM Wiki plan.", "warning");
    return;
  }

  await applyWikiPreview(currentPreview);
  currentPreview = null;
  currentDownloadedPage = null;
  closeMainUi();
}

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const LLM_REQUEST_TIMEOUT_MS = 90000;
const MCP_REQUEST_TIMEOUT_MS = 30000;

async function fetchTextFallback(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`Failed to download URL: HTTP ${response.status}`);
  return response.text();
}

async function requestText(url: string): Promise<string> {
  const request = (logseq.Request as unknown as {
    _request<T>(options: Record<string, unknown>): Promise<T>;
  });

  try {
    return await request._request<string>({
      url,
      method: "GET",
      returnType: "text",
      timeout: 30000,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "User-Agent": BROWSER_USER_AGENT,
      },
    });
  } catch {
    return fetchTextFallback(url);
  }
}

async function requestJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
  const request = (logseq.Request as unknown as {
    _request<T>(options: Record<string, unknown>): Promise<T>;
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    return await withTimeout(
      request._request<unknown>({
        url,
        method: "POST",
        returnType: "json",
        timeout: LLM_REQUEST_TIMEOUT_MS,
        headers,
        data: body as object,
      }),
      LLM_REQUEST_TIMEOUT_MS,
      `LLM request timed out after ${Math.round(LLM_REQUEST_TIMEOUT_MS / 1000)} seconds. Check the endpoint, model name, API key, and DeepSeek account status, then try a shorter page.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Not Found") || message.includes("404") || message.includes("invalid json response body")) {
      throw new Error(`LLM endpoint did not return JSON. Check that the endpoint is a chat completions URL, for example: ${url}`);
    }

    throw error;
  }
}

async function requestMcpJson(url: string, body: unknown): Promise<unknown> {
  const request = (logseq.Request as unknown as {
    _request<T>(options: Record<string, unknown>): Promise<T>;
  });

  const response = await withTimeout(
    request._request<unknown>({
      url,
      method: "POST",
      returnType: "text",
      timeout: MCP_REQUEST_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      data: body as object,
    }),
    MCP_REQUEST_TIMEOUT_MS,
    "MCP request timed out after 30 seconds.",
  );
  if (typeof response !== "string") return response;

  return parseMcpResponseText(response);
}

async function requestMcpEndpointJson(url: string, body: unknown): Promise<unknown> {
  return assertMcpSuccess(await requestMcpJson(url, body));
}

async function requestMcpNotification(url: string, body: unknown): Promise<void> {
  try {
    await requestMcpJson(url, body);
  } catch {
    // MCP notifications may return an empty body or no JSON response.
  }
}

async function openMcpSseEndpoint(url: string): Promise<{ endpoint: string; close: () => void }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
      },
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`MCP SSE connection failed: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const endpoint = extractMcpSseEndpoint(url, buffer);
      if (endpoint) {
        window.clearTimeout(timeout);
        return {
          endpoint: endpoint.endpoint,
          close: () => {
            controller.abort();
            void reader.cancel();
          },
        };
      }
    }

    throw new Error("MCP SSE endpoint event was not received.");
  } catch (error) {
    window.clearTimeout(timeout);
    controller.abort();
    throw error;
  }
}

async function withMcpEndpoint<T>(serviceUrl: string, callback: (endpoint: string) => Promise<T>): Promise<T> {
  if (!isMcpSseUrl(serviceUrl)) {
    return callback(serviceUrl);
  }

  const transport = await openMcpSseEndpoint(serviceUrl);
  try {
    await requestMcpEndpointJson(transport.endpoint, buildMcpInitializeRequest(1));
    await requestMcpNotification(transport.endpoint, buildMcpInitializedNotification());
    return await callback(transport.endpoint);
  } finally {
    transport.close();
  }
}

function parseMcpResponseText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("MCP service returned an empty response.");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);

  const dataLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  const jsonLine = [...dataLines].reverse().find((line: string) => line.startsWith("{") || line.startsWith("["));
  if (jsonLine) return JSON.parse(jsonLine);

  throw new Error("MCP service did not return JSON.");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function downloadPage(url: string): Promise<DownloadedPage> {
  let html = await requestText(url);
  let title = extractTitle(html, url);
  let text = extractReadableText(html);

  if (!text || text.length < 80) {
    html = await fetchTextFallback(url);
    title = extractTitle(html, url);
    text = extractReadableText(html);
  }

  if (!text || text.length < 80) {
    throw new Error("Downloaded page did not contain enough readable text to analyze.");
  }

  return {
    url,
    title,
    text,
  };
}

async function analyzeDownloadedPage(page: DownloadedPage, settings: PluginSettings): Promise<string> {
  const llmConfig = resolveLlmConfig(settings);
  validateLlmConfig(llmConfig);

  const rawText = cleanRawSourceText(page.text);
  const text = settings.piiRedaction ? redact(rawText) : rawText;
  const requestBody = buildLlmRequest({
    model: llmConfig.model,
    url: page.url,
    title: page.title,
    text: limitText(text, llmConfig.provider === "deepseek" ? 6000 : 12000),
    primaryLanguage: settings.primaryLanguage,
    enforceJsonMode: llmConfig.provider !== "deepseek",
  });
  const response = await requestJson(llmConfig.endpoint, llmConfig.apiKey, requestBody);

  return extractChatContent(response);
}

function openKnowledgeChatDialog() {
  currentChatTurns = [];
  lastChatSearchContext = null;
  activeMcpServiceIds = new Set(parseMcpServices(currentSettings().mcpServices).filter((service) => service.enabled).map((service) => service.id));
  logseq.provideModel({
    askKnowledgeBase: askKnowledgeBaseFromDialog,
    closeIngestModal: closeMainUi,
  });
  renderMainUi(chatDialogTemplate(currentChatTurns));
}

function openMcpManagerDialog() {
  logseq.provideModel({
    addMcpService: addMcpServiceFromDialog,
    toggleMcpService: toggleMcpServiceFromDialog,
    deleteMcpService: deleteMcpServiceFromDialog,
    closeIngestModal: closeMainUi,
  });
  renderMainUi(mcpManagerTemplate());
}

async function saveMcpServices(services: ReturnType<typeof parseMcpServices>) {
  const normalized = parseMcpServices(services);
  logseq.updateSettings({ mcpServices: normalized });
  activeMcpServiceIds = new Set([...activeMcpServiceIds].filter((id) => services.some((service) => service.id === id && service.enabled)));
}

async function addMcpServiceFromDialog() {
  const nameInput = document.querySelector<HTMLInputElement>("#llm-wiki-mcp-name-input");
  const urlInput = document.querySelector<HTMLInputElement>("#llm-wiki-mcp-url-input");

  try {
    const service = createMcpService({
      name: nameInput?.value ?? "",
      url: urlInput?.value ?? "",
      enabled: true,
    });
    const services = parseMcpServices(currentSettings().mcpServices).filter((item) => item.id !== service.id);
    services.push(service);
    await saveMcpServices(services);
    renderMainUi(mcpManagerTemplate(services));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logseq.UI.showMsg(message, "error");
  }
}

async function toggleMcpServiceFromDialog(event: Event) {
  const serviceId = readServiceId(event);
  if (!serviceId) return;
  const services = parseMcpServices(currentSettings().mcpServices).map((service) =>
    service.id === serviceId ? { ...service, enabled: !service.enabled } : service,
  );
  await saveMcpServices(services);
  renderMainUi(mcpManagerTemplate(services));
}

async function deleteMcpServiceFromDialog(event: Event) {
  const serviceId = readServiceId(event);
  if (!serviceId) return;
  const services = parseMcpServices(currentSettings().mcpServices).filter((service) => service.id !== serviceId);
  await saveMcpServices(services);
  renderMainUi(mcpManagerTemplate(services));
}

function toggleChatMcpService(event: Event) {
  const serviceId = readServiceId(event);
  if (!serviceId) return;
  if (activeMcpServiceIds.has(serviceId)) {
    activeMcpServiceIds.delete(serviceId);
  } else {
    activeMcpServiceIds.add(serviceId);
  }
  renderMainUi(chatDialogTemplate(currentChatTurns));
}

function readServiceId(event: Event): string | null {
  return (event.target as HTMLElement).closest<HTMLElement>("[data-service-id]")?.dataset.serviceId ?? null;
}

function pageDisplayName(page: PageEntity): string {
  return page.originalName || page.name;
}

function isKnowledgePage(page: PageEntity): boolean {
  const name = pageDisplayName(page);
  const layer = page.properties?.["knowledge-layer"];

  if (page["journal?"]) return false;
  if (name === logPageName() || name === indexPageName()) return true;
  if (name.startsWith("llm-wiki/raw/") || name.startsWith("llm-wiki___raw___")) return false;
  if (name.startsWith("llm-wiki/log") || name.startsWith("llm-wiki___log")) return false;
  if (layer === "wiki" || layer === "spine") return true;
  if (name.startsWith("llm-wiki/") || name.startsWith("llm-wiki___")) return true;

  return true;
}

function flattenBlockText(blocks: BlockEntity[]): string[] {
  const lines: string[] = [];
  const visit = (block: BlockEntity) => {
    const content = String(block.content ?? "").trim();
    if (content) lines.push(content);

    for (const child of block.children ?? []) {
      if (typeof child === "object" && "content" in child) {
        visit(child as BlockEntity);
      }
    }
  };

  blocks.forEach(visit);
  return lines;
}

function tokenizeQuery(query: string): string[] {
  const lower = query.toLowerCase();
  const latinTokens = lower.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
  const cjkPhrases = lower.match(/\p{Script=Han}{2,}/gu) ?? [];
  const cjkTokens = cjkPhrases.flatMap((phrase) => {
    const chars = Array.from(phrase);
    const tokens = [phrase];
    for (let index = 0; index < chars.length - 1; index += 1) {
      tokens.push(`${chars[index]}${chars[index + 1]}`);
    }
    return tokens;
  });
  const stopWords = new Set(["搜索", "关于", "信息", "内容", "一下", "有关", "资料", "什么"]);

  return Array.from(new Set([...latinTokens, ...cjkTokens].filter((token) => !stopWords.has(token))));
}

function scoreKnowledgeText(queryTokens: string[], pageName: string, text: string): number {
  const title = pageName.toLowerCase();
  const body = text.toLowerCase();
  return queryTokens.reduce((score, token) => {
    const titleScore = title.includes(token) ? 5 : 0;
    const bodyScore = body.includes(token) ? 1 : 0;
    return score + titleScore + bodyScore;
  }, 0);
}

async function retrieveKnowledgeSnippets(question: string): Promise<KnowledgeSnippet[]> {
  const pages = (await logseq.Editor.getAllPages()) ?? [];
  const candidates = pages.filter(isKnowledgePage);
  const queryTokens = tokenizeQuery(question);
  const scored: Array<KnowledgeSnippet & { score: number }> = [];

  for (const page of candidates.slice(0, 200)) {
    const pageName = pageDisplayName(page);
    const blocks = await logseq.Editor.getPageBlocksTree(pageName);
    const text = flattenBlockText(blocks).join("\n");
    if (!text.trim()) continue;

    const score = queryTokens.length ? scoreKnowledgeText(queryTokens, pageName, text) : 1;
    if (score <= 0) continue;

    scored.push({
      pageName,
      content: limitText(text, 2400),
      score,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.pageName.localeCompare(b.pageName))
    .slice(0, 6)
    .map(({ score: _score, ...snippet }) => snippet);
}

async function searchMcpServices(question: string, settings: PluginSettings): Promise<McpSearchResult[]> {
  const text = uiText(settings);
  const services = parseMcpServices(settings.mcpServices).filter((service) => service.enabled && activeMcpServiceIds.has(service.id));
  const results: McpSearchResult[] = [];

  for (const service of services.slice(0, 4)) {
    try {
      await withMcpEndpoint(service.url, async (endpoint) => {
        const toolsResponse = await requestMcpEndpointJson(endpoint, buildMcpToolsListRequest(2));
        const tools = extractMcpTools(toolsResponse);
        const tool = chooseSearchTool(tools);
        if (!tool) {
          const available = tools.length
            ? `${text.availableMcpTools}: ${tools.map((item) => item.name).join(", ")}`
            : "";
          results.push({
            serviceId: service.id,
            serviceName: service.name,
            title: text.noSearchToolTitle,
            content: available ? `${text.noSearchToolContent} ${available}` : text.noSearchToolContent,
          });
          return;
        }

        const searchResponse = await requestMcpEndpointJson(endpoint, buildMcpToolCallRequest(3, tool.name, question));
        const serviceResults = extractMcpSearchResults(service, searchResponse);
        results.push(...serviceResults);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        serviceId: service.id,
        serviceName: service.name,
        title: text.mcpSearchErrorTitle,
        content: message,
      });
    }
  }

  return results.slice(0, 8);
}

async function answerKnowledgeQuestion(
  question: string,
  settings: PluginSettings,
): Promise<{ answer: string; localSnippets: KnowledgeSnippet[]; mcpResults: McpSearchResult[] }> {
  const llmConfig = resolveLlmConfig(settings);
  validateLlmConfig(llmConfig);

  const snippets = await retrieveKnowledgeSnippets(question);
  const mcpResults = await searchMcpServices(question, settings);
  lastChatSearchContext = {
    question,
    localSnippets: snippets,
    mcpResults,
  };
  const requestBody = buildKnowledgeChatRequest({
    model: llmConfig.model,
    question,
    snippets,
    mcpResults,
    primaryLanguage: settings.primaryLanguage,
  });
  const response = await requestJson(llmConfig.endpoint, llmConfig.apiKey, requestBody);

  return {
    answer: extractChatContent(response),
    localSnippets: snippets,
    mcpResults,
  };
}

async function saveLastSearchContext(settings: PluginSettings) {
  if (!lastChatSearchContext || (!lastChatSearchContext.localSnippets.length && !lastChatSearchContext.mcpResults.length)) {
    await logseq.UI.showMsg(uiText(settings).noPreviousSearchContext, "warning");
    return "empty" as const;
  }

  const sourceUrl = `llm-wiki://chat-search/${todayIso()}/${encodeURIComponent(lastChatSearchContext.question.slice(0, 80))}`;
  const rawText = [
    `Question: ${lastChatSearchContext.question}`,
    "",
    "Local knowledge snippets:",
    ...lastChatSearchContext.localSnippets.map((snippet) => `[[${snippet.pageName}]]\n${snippet.content}`),
    "",
    "MCP search results:",
    ...lastChatSearchContext.mcpResults.map((result) => {
      const url = result.url ? `\nURL: ${result.url}` : "";
      return `${result.serviceName} / ${result.title}${url}\n${result.content}`;
    }),
  ].join("\n\n");

  currentDownloadedPage = {
    url: sourceUrl,
    title: `Chat search: ${lastChatSearchContext.question}`,
    text: rawText,
  };

  let preview: WikiChangePreview;
  let saveResult: "llm" | "fallback" = "llm";
  try {
    const llmConfig = resolveLlmConfig(settings);
    validateLlmConfig(llmConfig);
    const requestBody = buildSearchSaveRequest({
      model: llmConfig.model,
      question: lastChatSearchContext.question,
      localSnippets: lastChatSearchContext.localSnippets,
      mcpResults: lastChatSearchContext.mcpResults,
      primaryLanguage: settings.primaryLanguage,
    });
    const response = await requestJson(llmConfig.endpoint, llmConfig.apiKey, requestBody);
    preview = await buildWikiPreview(extractChatContent(response), sourceUrl, settings);
  } catch (error) {
    console.warn("LLM Wiki /save compilation failed; saving fallback context.", error);
    preview = await buildSearchContextFallbackPreview(lastChatSearchContext, sourceUrl, settings);
    saveResult = "fallback";
  }

  try {
    await applyWikiPreview(preview);
    return saveResult;
  } finally {
    currentDownloadedPage = null;
  }
}

async function buildSearchContextFallbackPreview(
  context: NonNullable<typeof lastChatSearchContext>,
  sourceUrl: string,
  settings: PluginSettings,
): Promise<WikiChangePreview> {
  const text = uiText(settings);
  const titlePrefix = settings.primaryLanguage === "zh" ? "搜索上下文" : "Search Context";
  const title = `${titlePrefix}: ${context.question.slice(0, 48)}`;
  const pageName = pageTitleToWikiPage(title, settings);
  const localLines = context.localSnippets.length
    ? context.localSnippets.map((snippet) => `- [[${snippet.pageName}]]\n  - ${limitText(snippet.content, 700).replace(/\n/g, "\n  - ")}`)
    : [settings.primaryLanguage === "zh" ? "- 无本地知识库片段" : "- No local knowledge snippets"];
  const mcpLines = context.mcpResults.length
    ? context.mcpResults.map((result) => {
        const url = result.url ? `\n  - URL: ${result.url}` : "";
        return `- ${result.serviceName}: ${result.title}${url}\n  - ${limitText(result.content, 700).replace(/\n/g, "\n  - ")}`;
      })
    : [settings.primaryLanguage === "zh" ? "- 无 MCP 搜索结果" : "- No MCP search results"];
  const content =
    settings.primaryLanguage === "zh"
      ? [`## 问题`, context.question, "", "## 本地知识库片段", ...localLines, "", "## MCP 搜索结果", ...mcpLines].join("\n")
      : [`## Question`, context.question, "", "## Local Knowledge Snippets", ...localLines, "", "## MCP Search Results", ...mcpLines].join("\n");
  const existing = await logseq.Editor.getPage(pageName);

  return {
    sourceUrl,
    sourceTitle: title,
    rawPageName: rawPageName({ title }),
    topic: titlePrefix,
    changes: [
      {
        title,
        pageName,
        action: existing ? "update" : "create",
        topic: titlePrefix,
        summary: text.savedSearchContextFallback,
        reason: text.savedSearchContextFallback,
        content,
        seeAlso: context.localSnippets.map((snippet) => snippet.pageName),
      },
    ],
  };
}

async function askKnowledgeBaseFromDialog() {
  const settings = currentSettings();
  const text = uiText(settings);
  const input = document.querySelector<HTMLTextAreaElement>("#llm-wiki-chat-input");
  const question = input?.value.trim() ?? "";
  if (!question) {
    await logseq.UI.showMsg(text.enterQuestionFirst, "warning");
    return;
  }

  if (question === "/save") {
    currentChatTurns.push({ role: "user", content: question });
    renderMainUi(chatDialogTemplate(currentChatTurns, true));
    try {
      const saveResult = await saveLastSearchContext(settings);
      if (saveResult !== "empty") {
        currentChatTurns.push({
          role: "assistant",
          content: saveResult === "fallback" ? text.savedSearchContextFallback : text.savedSearchContext,
        });
      }
      renderMainUi(chatDialogTemplate(currentChatTurns));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      currentChatTurns.push({ role: "assistant", content: `${text.errorPrefix}: ${message}` });
      renderMainUi(chatDialogTemplate(currentChatTurns));
      await logseq.UI.showMsg(message, "error");
    }
    return;
  }

  currentChatTurns.push({ role: "user", content: question });
  renderMainUi(chatDialogTemplate(currentChatTurns, true));

  try {
    const result = await answerKnowledgeQuestion(question, settings);
    currentChatTurns.push({
      role: "assistant",
      content: result.answer,
      localSources: result.localSnippets.map((snippet) => snippet.pageName),
      mcpSources: result.mcpResults.map((result) => `${result.serviceName}: ${result.title}`),
    });
    renderMainUi(chatDialogTemplate(currentChatTurns));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    currentChatTurns.push({ role: "assistant", content: `${text.errorPrefix}: ${message}` });
    renderMainUi(chatDialogTemplate(currentChatTurns));
    await logseq.UI.showMsg(message, "error");
  }
}

async function togglePrimaryLanguage() {
  const settings = currentSettings();
  const nextLanguage = settings.primaryLanguage === "zh" ? "en" : "zh";
  logseq.updateSettings({ primaryLanguage: nextLanguage });
  await logseq.UI.showMsg(`LLM Wiki language: ${nextLanguage === "zh" ? "中文" : "English"}`, "success");
}

function readClickPoint(event: unknown): { x: number; y: number } | null {
  const record = event as Record<string, unknown> | undefined;
  const payload = record?.payload as Record<string, unknown> | undefined;
  const nativeEvent = record?.event as Record<string, unknown> | undefined;
  const sources = [record, payload, nativeEvent];

  for (const source of sources) {
    const x = source?.clientX ?? source?.x;
    const y = source?.clientY ?? source?.y;
    if (typeof x === "number" && typeof y === "number" && x > 0 && y > 0) {
      return { x, y };
    }
  }

  return null;
}

function openToolbarMenu(event?: unknown) {
  const button = document.querySelector<HTMLElement>(".llm-wiki-toolbar-button");
  const rect = button?.getBoundingClientRect();
  const menuWidth = 156;
  const clickPoint = readClickPoint(event);
  const validRect = rect && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0;
  const viewportWidth = Math.max(window.innerWidth, document.documentElement.clientWidth, 320);
  const anchorX = clickPoint?.x ?? (validRect ? rect.left + rect.width / 2 : viewportWidth - 90);
  const anchorY = clickPoint?.y ?? (validRect ? rect.bottom : 34);
  const left = Math.max(8, Math.min(anchorX - menuWidth / 2, viewportWidth - menuWidth - 8));
  const top = Math.max(8, anchorY + 8);

  logseq.provideModel({
    openUrlDialog,
    openKnowledgeChatDialog,
    openMcpManagerDialog,
    togglePrimaryLanguage,
    closeIngestModal: closeMainUi,
  });
  renderMainUi(toolbarMenuTemplate({ left, top }), "llm-wiki-menu-root");
}

function openUrlDialog() {
  logseq.provideModel({
    analyzeUrlFromDialog,
    closeIngestModal: closeMainUi,
  });
  renderMainUi(urlDialogTemplate());
}

async function analyzeUrlFromDialog() {
  const input = document.querySelector<HTMLInputElement>("#llm-wiki-url-input");
  const rawUrl = input?.value ?? "";

  try {
    const url = normalizeHttpUrl(rawUrl);
    const settings = currentSettings();

    renderMainUi(statusTemplate("Analyzing URL", "Downloading page content..."));
    const page = await downloadPage(url);
    currentDownloadedPage = page;

    renderMainUi(statusTemplate("Analyzing URL", "Sending readable content to the configured LLM..."));
    const planText = await analyzeDownloadedPage(page, settings);
    const preview = await buildWikiPreview(planText, url, settings);
    currentPreview = preview;

    if (!settings.requireApproval) {
      await applyWikiPreview(preview);
      closeMainUi();
      return;
    }

    logseq.provideModel({
      approveWikiPlan: approveCurrentWikiPlan,
      closeIngestModal: closeMainUi,
    });
    renderMainUi(wikiPreviewTemplate(preview));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderMainUi(statusTemplate("Analyze URL Failed", message));
    await logseq.UI.showMsg(message, "error");
  }
}

async function createIngestProposal() {
  const block = await logseq.Editor.getCurrentBlock();
  if (!block?.uuid) {
    await logseq.UI.showMsg("Select a source block before ingesting.", "warning");
    return;
  }

  const settings = currentSettings();
  const rawContent = String(block.content ?? "");
  const content = settings.piiRedaction ? redact(rawContent) : rawContent;
  const proposal = buildIngestProposal({
    sourceBlockUuid: block.uuid,
    content,
    suggestedTitle: "Inbox",
    settings,
  });

  if (!settings.requireApproval) {
    await writeProposal(proposal);
    return;
  }

  logseq.provideModel({
    approveIngest: approveCurrentProposal,
    closeIngestModal: closeMainUi,
  });

  currentProposal = proposal;
  renderMainUi(modalTemplate(proposal));
}

function injectStyles() {
  const styles = `
    html,
    body,
    #app {
      background: transparent;
      height: 100%;
      margin: 0;
      width: 100%;
    }

    #logseq-llm-wiki-root {
      background: rgba(17, 24, 39, 0.72);
      bottom: 0;
      display: grid;
      left: 0;
      place-items: center;
      position: fixed;
      right: 0;
      top: 0;
      z-index: 999;
    }

    #logseq-llm-wiki-root.llm-wiki-menu-root {
      background: transparent;
      display: block;
      pointer-events: auto;
    }

    .llm-wiki-modal {
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      box-shadow: 0 24px 64px rgba(15, 23, 42, 0.24);
      color: #111827;
      font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-width: 560px;
      padding: 18px;
      width: min(560px, calc(100vw - 32px));
    }

    .llm-wiki-modal-wide {
      max-width: 720px;
    }

    .llm-wiki-chat-modal {
      max-width: 760px;
    }

    .llm-wiki-modal header,
    .llm-wiki-modal footer {
      align-items: center;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    .llm-wiki-modal section {
      margin: 16px 0;
    }

    .llm-wiki-label {
      color: #6b7280;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 4px;
      text-transform: uppercase;
    }

    .llm-wiki-target {
      background: #f3f4f6;
      border-radius: 6px;
      padding: 8px 10px;
    }

    .llm-wiki-input {
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      box-sizing: border-box;
      color: #111827;
      font: inherit;
      min-height: 38px;
      padding: 7px 10px;
      width: 100%;
    }

    .llm-wiki-input:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
      outline: none;
    }

    .llm-wiki-chat-log {
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: min(52vh, 460px);
      overflow: auto;
      padding: 12px;
    }

    .llm-wiki-mcp-chat-bar {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px 0;
    }

    .llm-wiki-mcp-toggle {
      background: #ffffff;
      border-color: #d1d5db;
      color: #111827;
    }

    .llm-wiki-mcp-toggle.is-active {
      background: #065f46;
      border-color: #065f46;
      color: #ffffff;
    }

    .llm-wiki-chat-empty,
    .llm-wiki-chat-loading {
      color: #6b7280;
      text-align: center;
    }

    .llm-wiki-chat-message {
      border-radius: 10px;
      max-width: 88%;
      padding: 10px 12px;
    }

    .llm-wiki-chat-message-user {
      align-self: flex-end;
      background: #dbeafe;
    }

    .llm-wiki-chat-message-assistant {
      align-self: flex-start;
      background: #ffffff;
      border: 1px solid #e5e7eb;
    }

    .llm-wiki-chat-role {
      color: #6b7280;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 4px;
      text-transform: uppercase;
    }

    .llm-wiki-chat-content {
      white-space: normal;
    }

    .llm-wiki-chat-sources {
      color: #4b5563;
      font-size: 12px;
      margin-top: 8px;
    }

    .llm-wiki-chat-form {
      align-items: flex-end;
    }

    .llm-wiki-chat-input {
      min-height: 74px;
      resize: vertical;
    }

    .llm-wiki-help,
    .llm-wiki-status {
      color: #6b7280;
      margin-top: 8px;
    }

    .llm-wiki-change-list {
      margin: 8px 0 0;
      max-height: min(42vh, 360px);
      overflow: auto;
      padding-left: 22px;
    }

    .llm-wiki-change-list li {
      margin: 8px 0;
    }

    .llm-wiki-mcp-form {
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(120px, 0.7fr) minmax(220px, 1.3fr) auto;
    }

    .llm-wiki-mcp-list {
      display: grid;
      gap: 8px;
      list-style: none;
      margin: 0;
      max-height: min(42vh, 360px);
      overflow: auto;
      padding: 0;
    }

    .llm-wiki-mcp-row {
      align-items: center;
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 10px;
    }

    .llm-wiki-mcp-url {
      color: #6b7280;
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .llm-wiki-mcp-actions {
      display: flex;
      flex-shrink: 0;
      gap: 6px;
    }

    .llm-wiki-modal button {
      background: #111827;
      border: 1px solid #111827;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      min-height: 32px;
      padding: 6px 12px;
    }

    .llm-wiki-modal button + button,
    .llm-wiki-modal header button {
      background: #ffffff;
      color: #111827;
    }

    .cp__header .llm-wiki-toolbar-button,
    .toolbar .llm-wiki-toolbar-button,
    .llm-wiki-toolbar-button {
      align-items: center;
      border-radius: 4px;
      color: currentColor;
      display: inline-flex;
      font-weight: 700;
      height: 28px;
      justify-content: center;
      letter-spacing: 0;
      line-height: 1;
      min-width: 28px;
      padding: 0 3px;
      position: relative;
      text-decoration: none;
      top: -7px;
      vertical-align: middle;
    }

    .llm-wiki-toolbar-button:hover {
      background: rgba(107, 114, 128, 0.12);
    }

    .llm-wiki-toolbar-icon {
      display: block;
      fill: none;
      height: 22px;
      pointer-events: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.9;
      width: 22px;
    }

    .llm-wiki-floating-menu {
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.18);
      color: #111827;
      display: grid;
      gap: 4px;
      min-width: 156px;
      padding: 6px;
      position: fixed;
      z-index: 1001;
    }

    .llm-wiki-floating-menu button {
      background: transparent;
      border: 0;
      border-radius: 6px;
      color: inherit;
      cursor: pointer;
      font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 7px 9px;
      text-align: left;
      white-space: nowrap;
    }

    .llm-wiki-floating-menu button:hover {
      background: #f3f4f6;
    }

    @media (max-width: 640px) {
      .llm-wiki-mcp-form,
      .llm-wiki-mcp-row {
        grid-template-columns: 1fr;
      }

      .llm-wiki-mcp-row {
        align-items: stretch;
        display: grid;
      }
    }
  `;

  logseq.provideStyle(styles);

  let localStyle = document.querySelector<HTMLStyleElement>("#llm-wiki-local-styles");
  if (!localStyle) {
    localStyle = document.createElement("style");
    localStyle.id = "llm-wiki-local-styles";
    document.head.appendChild(localStyle);
  }
  localStyle.textContent = styles;
}

async function main() {
  logseq.useSettingsSchema([...settingsSchema]);
  injectStyles();

  logseq.App.registerUIItem("toolbar", {
    key: "llm-wiki-ingest",
    template: `
      <a class="button llm-wiki-toolbar-button" data-on-click="openToolbarMenu" title="LLM Wiki" aria-label="LLM Wiki menu">
        <svg class="llm-wiki-toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.4 5.2a3.1 3.1 0 0 1 5.3-1.7 3.2 3.2 0 0 1 4.6 3.6 3.5 3.5 0 0 1 1.5 6.3 3.3 3.3 0 0 1-3.6 4.9 3.1 3.1 0 0 1-5.2.9 3.1 3.1 0 0 1-5.3-2.2 3.6 3.6 0 0 1-.1-6.8 3.4 3.4 0 0 1 2.8-5Z"/>
          <path d="M8.4 5.2v4.2M13.7 3.5v5.1M18.3 7.1h-3.1M5.6 10.2h4.1M11 19.2v-5.1M16.2 18.3v-4.6M19.8 13.4h-4.1M7.3 16.9h3.9"/>
        </svg>
      </a>
    `,
  });

  logseq.App.registerCommandShortcut(
    { binding: "ctrl+u", mode: "global" },
    () => {
      openUrlDialog();
    },
    {
      key: "llm-wiki-open-url-dialog",
      label: "LLM Wiki: 输入URL",
      desc: "Open the LLM Wiki URL input dialog.",
    },
  );

  logseq.provideModel({
    createIngestProposal,
    openToolbarMenu: (event?: unknown) => openToolbarMenu(event),
    openUrlDialog,
    openKnowledgeChatDialog,
    openMcpManagerDialog,
    addMcpService: addMcpServiceFromDialog,
    toggleMcpService: toggleMcpServiceFromDialog,
    deleteMcpService: deleteMcpServiceFromDialog,
    toggleChatMcpService,
    togglePrimaryLanguage,
    askKnowledgeBase: askKnowledgeBaseFromDialog,
    analyzeUrlFromDialog,
    approveIngest: approveCurrentProposal,
    approveWikiPlan: approveCurrentWikiPlan,
    closeIngestModal: closeMainUi,
  });
}

logseq.ready(main).catch(console.error);
