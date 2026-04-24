export interface DownloadedPage {
  url: string;
  title: string;
  text: string;
}

export function normalizeHttpUrl(input: string): string {
  const trimmed = input.trim();
  const parsed = new URL(trimmed);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported.");
  }

  return parsed.toString();
}

export function extractTitle(html: string, fallbackUrl: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const cleaned = decodeHtml(title ?? "").replace(/\s+/g, " ").trim();

  if (cleaned) return cleaned.slice(0, 120);

  try {
    return new URL(fallbackUrl).hostname;
  } catch {
    return "Imported Web Page";
  }
}

export function extractReadableText(html: string): string {
  const visibleText = decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|article|section|h[1-6]|li|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );

  if (visibleText.length >= 120) return visibleText;

  return extractEmbeddedText(html, visibleText);
}

const rawSourceNoiseLines = new Set([
  "听过",
  "收藏",
  "留言",
  "分享",
  "，轻点两下取消在看",
  "在看",
  "，轻点两下取消赞",
  "赞",
  "小程序",
  "视频",
  "。",
  "，",
  "：",
  "微信扫一扫可打开此内容， 使用完整服务",
  "分析",
  "×",
  "允许",
  "取消",
  "微信扫一扫 使用小程序",
  "知道了",
  "向上滑动看下一个",
  "TiDB-平凯数据库",
  "轻触阅读原文",
  "继续滑动看下一个",
  "微信扫一扫 关注该公众号",
  "阅读原文",
  "预览时标签不可点",
  "在小说阅读器中沉浸阅读",
  "去阅读",
  "在小说阅读器读本章",
]);

const rawSourceNoisePatterns = [/^Published:\s+/i, /^Collected:\s+/i];

export function cleanRawSourceText(text: string): string {
  const lines: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/[ \t]+/g, " ");

    if (!line) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }

    if (isRawSourceNoiseLine(line)) continue;
    lines.push(line);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function limitText(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}\n\n[Content truncated for analysis.]`;
}

function isRawSourceNoiseLine(line: string): boolean {
  return rawSourceNoiseLines.has(line) || rawSourceNoisePatterns.some((pattern) => pattern.test(line));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractEmbeddedText(html: string, visibleText: string): string {
  const snippets = new Set<string>();
  if (visibleText) snippets.add(visibleText);

  for (const match of html.matchAll(/<meta[^>]+(?:name|property)=["'][^"']*(?:description|title|keywords)[^"']*["'][^>]+content=["']([^"']+)["'][^>]*>/gi)) {
    addSnippet(snippets, match[1]);
  }

  for (const match of html.matchAll(/"([^"]{8,500})"/g)) {
    const value = match[1]
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n");

    if (/[\u4e00-\u9fff]/.test(value)) addSnippet(snippets, value);
  }

  return Array.from(snippets)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function addSnippet(snippets: Set<string>, value: string) {
  const cleaned = decodeHtml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length >= 12) snippets.add(cleaned);
}
