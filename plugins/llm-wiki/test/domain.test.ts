import {
  buildIngestProposal,
  buildUrlAnalysisProposal,
  defaultSettings,
  languageLabel,
  normalizePrimaryLanguage,
  normalizeWikiPlan,
  rawPageName,
  pageTitleToWikiPage,
  pathToLayer,
  slugify,
  summarizeBlock,
  todayIso,
} from "../src/domain";

describe("domain", () => {
  it("classifies graph paths into knowledge layers", () => {
    expect(pathToLayer("journals/2026_04_23.md")).toBe("raw");
    expect(pathToLayer("pages/concepts.md")).toBe("wiki");
    expect(pathToLayer("pages/writing___draft.md")).toBe("output");
    expect(pathToLayer("AGENTS.md")).toBe("schema");
  });

  it("builds an ingest proposal for the wiki inbox", () => {
    const proposal = buildIngestProposal({
      sourceBlockUuid: "abc",
      content: "#clippings LLM Wiki turns retrieval into compilation.",
      suggestedTitle: "Inbox",
    });

    expect(proposal.targetPage).toBe("Inbox");
    expect(proposal.summary).toBe("LLM Wiki turns retrieval into compilation.");
    expect(proposal.properties["confidence-score"]).toBe(defaultSettings.defaultConfidence);
    expect(proposal.properties.status).toBe("current");
  });

  it("keeps summaries short", () => {
    expect(summarizeBlock("x".repeat(400)).length).toBeLessThanOrEqual(280);
  });

  it("normalizes primary language settings", () => {
    expect(defaultSettings.primaryLanguage).toBe("zh");
    expect(normalizePrimaryLanguage("en")).toBe("en");
    expect(normalizePrimaryLanguage("zh")).toBe("zh");
    expect(normalizePrimaryLanguage("anything")).toBe("zh");
    expect(languageLabel("zh")).toBe("中文");
    expect(languageLabel("en")).toBe("English");
  });

  it("builds a url analysis proposal with source-url metadata", () => {
    const proposal = buildUrlAnalysisProposal({
      url: "https://example.com/post",
      analysis: "## Summary\nUseful article.",
      title: "Example Post",
    });

    expect(proposal.targetPage).toBe("Example Post");
    expect(proposal.properties["source-url"]).toBe("https://example.com/post");
    expect(proposal.properties["source-block"]).toBe("url:https://example.com/post");
  });

  it("maps titles into the configured wiki namespace", () => {
    expect(pageTitleToWikiPage("LLM Wiki")).toBe("LLM Wiki");
    expect(pageTitleToWikiPage("llm-wiki/LLM Wiki")).toBe("llm-wiki/LLM Wiki");
  });

  it("normalizes structured wiki plans", () => {
    const plan = normalizeWikiPlan(
      JSON.stringify({
        pages: [{ title: "LLM Wiki", reason: "Core concept", content: "- Durable compiled knowledge" }],
      }),
      "https://example.com",
    );

    expect(plan.sourceUrl).toBe("https://example.com");
    expect(plan.pages[0].title).toBe("LLM Wiki");
    expect(plan.pages[0].content).toContain("Durable");
  });

  it("builds raw page names with date and slug", () => {
    expect(todayIso(new Date("2026-04-23T00:00:00Z"))).toBe("2026-04-23");
    expect(slugify("Hungary Drops Veto!")).toBe("hungary-drops-veto");
    expect(rawPageName({ title: "Hungary Drops Veto", date: "2026-04-23" })).toBe(
      "llm-wiki/raw/2026-04-23-hungary-drops-veto",
    );
  });

  it("normalizes fenced json wiki plans", () => {
    const plan = normalizeWikiPlan(
      '```json\n{"pages":[{"title":"Agent","content":"- [[LLM Wiki]] compiler"}]}\n```',
      "https://example.com",
    );

    expect(plan.pages[0].title).toBe("Agent");
  });
});
