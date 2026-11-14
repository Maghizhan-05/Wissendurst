/**
 * Event Rules (D-022). Stored as a JSON array of paragraphs in events.rules.
 * In the editor, a blank line separates paragraphs; single line breaks inside
 * a paragraph are kept. Older events stored one rule per line (one element per
 * line); each of those simply becomes its own paragraph, so nothing needs to
 * be migrated. The public page renders paragraphs as written — no numbering.
 * Pure (no imports) so the server action, the editor and tests share it.
 */

export const MAX_RULE_PARAGRAPHS = 100;
export const MAX_RULE_PARAGRAPH_LENGTH = 2000;

/** Editor text → stored paragraphs (blank-line separated, line breaks kept). */
export function parseRulesText(text: string | null | undefined): string[] {
  const normalized = (text ?? "").replace(/\r\n?/g, "\n");
  return normalized
    .split(/\n[ \t]*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        // also drops blank lines left over from 3+ newlines
        .trim(),
    )
    .filter((paragraph) => paragraph.trim().length > 0);
}

/** Stored value (any shape found in the jsonb column) → clean paragraphs. */
export function normalizeStoredRules(value: unknown): string[] {
  if (typeof value === "string") return parseRulesText(value);
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.replace(/\r\n?/g, "\n").trimEnd())
    .filter((r) => r.trim().length > 0);
}

/** Stored paragraphs → editor text (paragraphs separated by a blank line). */
export function rulesToEditorText(value: unknown): string {
  return normalizeStoredRules(value).join("\n\n");
}

/** Null when the parsed rules fit the database limits, else a message. */
export function rulesError(paragraphs: readonly string[]): string | null {
  if (paragraphs.length > MAX_RULE_PARAGRAPHS)
    return `Rules can have at most ${MAX_RULE_PARAGRAPHS} paragraphs.`;
  if (paragraphs.some((p) => p.length > MAX_RULE_PARAGRAPH_LENGTH))
    return `Each rules paragraph can be at most ${MAX_RULE_PARAGRAPH_LENGTH} characters.`;
  return null;
}
