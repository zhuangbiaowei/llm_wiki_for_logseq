import { cleanRawSourceText, extractReadableText, extractTitle, limitText, normalizeHttpUrl } from "../src/web";

describe("web helpers", () => {
  it("accepts only http urls", () => {
    expect(normalizeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(() => normalizeHttpUrl("file:///secret.txt")).toThrow(/Only http/);
  });

  it("extracts title and visible text from html", () => {
    const html = "<html><head><title> Test Page </title><style>.x{}</style></head><body><h1>Hello</h1><script>x()</script><p>World</p></body></html>";

    expect(extractTitle(html, "https://example.com")).toBe("Test Page");
    expect(extractReadableText(html)).toContain("Hello");
    expect(extractReadableText(html)).toContain("World");
    expect(extractReadableText(html)).not.toContain("x()");
  });

  it("falls back to embedded chinese metadata and json text", () => {
    const html =
      '<html><head><meta name="description" content="这是一段足够有用的中文摘要内容"></head><body><script>window.x={"content":"刘维是一位歌手，代表作品包括藏起我。"}</script></body></html>';

    expect(extractReadableText(html)).toContain("中文摘要内容");
    expect(extractReadableText(html)).toContain("刘维是一位歌手");
  });

  it("limits long content", () => {
    expect(limitText("x".repeat(20), 10)).toContain("[Content truncated for analysis.]");
  });

  it("removes raw source UI noise without dropping article content", () => {
    const cleaned = cleanRawSourceText(
      [
        "听过",
        "收藏",
        "这里是正文，提到了分享机制。",
        "，轻点两下取消赞",
        "微信扫一扫 关注该公众号",
        "阅读原文",
        "Published: Unknown",
        "正文里也可能提到阅读原文这个词，但不是整行。",
      ].join("\n"),
    );

    expect(cleaned).toContain("这里是正文，提到了分享机制。");
    expect(cleaned).toContain("正文里也可能提到阅读原文这个词");
    expect(cleaned).not.toContain("听过");
    expect(cleaned).not.toContain("微信扫一扫");
    expect(cleaned).not.toContain("Published: Unknown");
  });
});
