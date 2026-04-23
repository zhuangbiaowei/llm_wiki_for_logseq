const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const secretPattern = /\b(?:sk|api[_-]?key|token)[-_A-Za-z0-9]{8,}\b/gi;

export function redact(text: string): string {
  return text
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(secretPattern, "[REDACTED_SECRET]");
}
