export interface BatchBlock {
  content: string;
  properties?: Record<string, string | number>;
  children?: BatchBlock[];
}

interface ParsedLine {
  depth: number;
  content: string;
  sectionHeading: boolean;
}

export function markdownToBlocks(markdown: string): BatchBlock[] {
  const lines = markdown
    .split(/\r?\n/)
    .map(parseLine)
    .filter((line): line is ParsedLine => Boolean(line?.content));

  const roots: BatchBlock[] = [];
  const stack: Array<{ depth: number; block: BatchBlock; sectionHeading: boolean }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const block = lineToBlock(line.content);
    const parentScope = stack[stack.length - 1];
    const effectiveDepth =
      parentScope?.sectionHeading && !line.sectionHeading && line.depth <= parentScope.depth
        ? parentScope.depth + 1
        : line.depth;

    while (stack.length > 0 && stack[stack.length - 1].depth >= effectiveDepth) {
      stack.pop();
    }

    const parent = stack[stack.length - 1]?.block;
    if (parent) {
      parent.children ??= [];
      parent.children.push(block);
    } else {
      roots.push(block);
    }

    stack.push({ depth: effectiveDepth, block, sectionHeading: line.sectionHeading });
  }

  return roots;
}

export function appendMetadataBlocks(blocks: BatchBlock[], metadata: Record<string, string | number>): BatchBlock[] {
  if (blocks.length === 0) return [];

  const [first, ...rest] = blocks;
  return [
    {
      ...first,
      properties: {
        ...first.properties,
        ...metadata,
      },
    },
    ...rest,
  ];
}

function parseLine(rawLine: string): ParsedLine | null {
  if (!rawLine.trim()) return null;

  const indent = rawLine.match(/^\s*/)?.[0].replace(/\t/g, "  ").length ?? 0;
  const trimmed = rawLine.trim();
  const unordered = trimmed.match(/^[-*+]\s+(.*)$/);
  const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
  const listContent = unordered?.[1] ?? ordered?.[1] ?? trimmed;
  const heading = listContent.match(/^#{1,6}\s+(.*)$/);
  const strongHeading = listContent.match(/^\*\*(.+?)\*\*:?$/);
  const content = strongHeading?.[1] ?? heading?.[1] ?? listContent;

  return {
    depth: Math.floor(indent / 2),
    content,
    sectionHeading: Boolean(heading || strongHeading),
  };
}

function normalizeBlockContent(content: string): string {
  return content.trim().replace(/\s+$/g, "");
}

function lineToBlock(content: string): BatchBlock {
  const properties: Record<string, string | number> = {};
  let cleaned = normalizeBlockContent(content);

  cleaned = cleaned.replace(/\s+(source-url|source|confidence-score|status)::\s*(\S[^\n]*?)\s*$/g, (_match, key: string, value: string) => {
    properties[key] = value.trim();
    return "";
  });

  return {
    content: normalizeBlockContent(cleaned),
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
  };
}
