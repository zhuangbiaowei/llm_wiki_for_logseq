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

export function limitText(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}\n\n[Content truncated for analysis.]`;
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
