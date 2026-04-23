import { redact } from "../src/redaction";

describe("redaction", () => {
  it("redacts emails and api-key-like values", () => {
    expect(redact("Contact user@example.com with key sk-abc123456789")).toBe(
      "Contact [REDACTED_EMAIL] with key [REDACTED_SECRET]",
    );
  });
});
