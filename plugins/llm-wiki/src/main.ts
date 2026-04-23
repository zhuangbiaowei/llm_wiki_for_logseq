import "@logseq/libs";
import type { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";
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
import { buildLlmRequest, extractChatContent, resolveLlmConfig, validateLlmConfig } from "./llm";
import { redact } from "./redaction";
import { extractReadableText, extractTitle, limitText, normalizeHttpUrl, type DownloadedPage } from "./web";

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
    enumChoices: ["openai", "openai-compatible", "ollama"],
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
];

let currentProposal: ReturnType<typeof buildIngestProposal> | null = null;
let currentPreview: WikiChangePreview | null = null;
let currentDownloadedPage: DownloadedPage | null = null;

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
      configured.llmProvider === "openai" || configured.llmProvider === "openai-compatible" || configured.llmProvider === "ollama"
        ? configured.llmProvider
        : defaultSettings.llmProvider,
    llmEndpoint: String(configured.llmEndpoint ?? defaultSettings.llmEndpoint),
    llmApiKey: String(configured.llmApiKey ?? defaultSettings.llmApiKey),
    llmModel: String(configured.llmModel ?? defaultSettings.llmModel),
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

function renderMainUi(template: string) {
  const app = document.querySelector("#app");
  if (!app) {
    logseq.hideMainUI();
    void logseq.UI.showMsg("LLM Wiki UI container was not found.", "error");
    return;
  }

  app.innerHTML = `<main id="logseq-llm-wiki-root">${template}</main>`;
  bindMainUiHandlers();
  logseq.showMainUI({ autoFocus: true });
  document.querySelector<HTMLInputElement>("#llm-wiki-url-input")?.focus();
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
    if (action === "analyzeUrlFromDialog") void analyzeUrlFromDialog();
    if (action === "approveIngest") void approveCurrentProposal();
    if (action === "approveWikiPlan") void approveCurrentWikiPlan();
  });

  document.onkeydown = (event) => {
    if (event.key === "Escape") closeMainUi();
    if (event.key === "Enter" && document.activeElement?.id === "llm-wiki-url-input") {
      void analyzeUrlFromDialog();
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
    [`Source: ${page.url}`, `Collected: ${todayIso()}`, "Published: Unknown", "", limitText(page.text, 20000)].join("\n"),
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

  const [first, ...rest] = blocks;
  const root = await logseq.Editor.appendBlockInPage(pageName, first.content, {
    properties: first.properties ?? {},
  });
  if (!root) throw new Error(`Failed to append block to [[${pageName}]].`);

  if (first.children?.length) {
    await logseq.Editor.insertBatchBlock(root.uuid, first.children, { sibling: false });
  }

  for (const block of rest) {
    const sibling = await logseq.Editor.insertBlock(root.uuid, block.content, {
      sibling: true,
      properties: block.properties ?? {},
    });
    if (sibling && block.children?.length) {
      await logseq.Editor.insertBatchBlock(sibling.uuid, block.children, { sibling: false });
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
    return await request._request<unknown>({
      url,
      method: "POST",
      returnType: "json",
      timeout: 60000,
      headers,
      data: body as object,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Not Found") || message.includes("404") || message.includes("invalid json response body")) {
      throw new Error(`LLM endpoint did not return JSON. Check that the endpoint is a chat completions URL, for example: ${url}`);
    }

    throw error;
  }
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

  const text = settings.piiRedaction ? redact(page.text) : page.text;
  const requestBody = buildLlmRequest({
    model: llmConfig.model,
    url: page.url,
    title: page.title,
    text: limitText(text),
    primaryLanguage: settings.primaryLanguage,
  });
  const response = await requestJson(llmConfig.endpoint, llmConfig.apiKey, requestBody);

  return extractChatContent(response);
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
      <a class="button llm-wiki-toolbar-button" data-on-click="openUrlDialog" title="Analyze URL with LLM Wiki" aria-label="Analyze URL with LLM Wiki">
        <svg class="llm-wiki-toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.4 5.2a3.1 3.1 0 0 1 5.3-1.7 3.2 3.2 0 0 1 4.6 3.6 3.5 3.5 0 0 1 1.5 6.3 3.3 3.3 0 0 1-3.6 4.9 3.1 3.1 0 0 1-5.2.9 3.1 3.1 0 0 1-5.3-2.2 3.6 3.6 0 0 1-.1-6.8 3.4 3.4 0 0 1 2.8-5Z"/>
          <path d="M8.4 5.2v4.2M13.7 3.5v5.1M18.3 7.1h-3.1M5.6 10.2h4.1M11 19.2v-5.1M16.2 18.3v-4.6M19.8 13.4h-4.1M7.3 16.9h3.9"/>
        </svg>
      </a>
    `,
  });

  logseq.provideModel({
    createIngestProposal,
    openUrlDialog,
    analyzeUrlFromDialog,
    approveIngest: approveCurrentProposal,
    approveWikiPlan: approveCurrentWikiPlan,
    closeIngestModal: closeMainUi,
  });
}

logseq.ready(main).catch(console.error);
