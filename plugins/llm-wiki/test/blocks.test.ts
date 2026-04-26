import { appendMetadataBlocks, markdownToBlocks } from "../src/blocks";

describe("blocks", () => {
  it("turns markdown lists and headings into a Logseq block tree", () => {
    const blocks = markdownToBlocks("## 演唱作品\n  - [[藏起我]] (2023) - 演唱者\n    - source:: 藏起我");

    expect(blocks).toEqual([
      {
        content: "演唱作品",
        children: [
          {
            content: "[[藏起我]] (2023) - 演唱者",
            children: [{ content: "source:: 藏起我" }],
          },
        ],
      },
    ]);
  });

  it("converts bold section titles and inline source-url metadata", () => {
    const blocks = markdownToBlocks(
      "- **获奖记录**\n- 2010年：担任第五届“关爱留守儿童”系列活动“爱心大使”。 source-url:: https://example.com/a",
    );

    expect(blocks).toEqual([
      {
        content: "获奖记录",
        children: [
          {
            content: "2010年：担任第五届“关爱留守儿童”系列活动“爱心大使”。",
            properties: { "source-url": "https://example.com/a" },
          },
        ],
      },
    ]);
  });

  it("keeps GitHub issue references from becoming Logseq tag pages", () => {
    const blocks = markdownToBlocks(
      "- Security hardening (#4023)\n- See #3658, #3730 and issue #99.\n- Keep URL fragments like https://example.com/a#section unchanged.",
    );

    expect(blocks).toEqual([
      { content: "Security hardening (issue 4023)" },
      { content: "See issue 3658, issue 3730 and issue 99." },
      { content: "Keep URL fragments like https://example.com/a#section unchanged." },
    ]);
  });

  it("appends metadata as sibling blocks", () => {
    expect(appendMetadataBlocks([{ content: "A" }], { status: "current" })).toEqual([
      { content: "A", properties: { status: "current" } },
    ]);
  });
});
