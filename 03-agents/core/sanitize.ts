// ============================================================
// TERMINAL-SAFE TEXT
// ============================================================
// Model output and customer data are shown in the terminal: in the
// approval box, the model's lines, ask_human questions and chat
// replies. They are also written to traces that people grep.
// WHY escape them: a terminal obeys control characters. A carriage
// return can overwrite a line the human already read, an ESC
// sequence can clear the screen or recolour text, and Unicode bidi
// overrides can make "approve A" render as "approve B" (the Trojan
// Source trick). Invisible characters (zero-width spaces, a BOM)
// can make two different strings look identical. Any of these could
// hide or fake what a human is approving or reading.
//
// The fix: every such character except the newline is shown as a
// visible escape (for example \r, \x1b, \u202e) instead of being
// obeyed. The text still reads fine; it just can't steer the screen.
//
// This file holds no raw bidi or invisible characters: every one is
// written as a \u escape, so the file itself can't be spoofed.
// ============================================================

// What gets escaped:
//   C0 controls except the newline (U+0000 to U+0009, U+000B to U+001F)
//   DEL and the C1 controls (U+007F to U+009F)
//   bidi marks: U+061C, U+200E, U+200F
//   zero-width characters: U+200B to U+200D
//   line and paragraph separators: U+2028, U+2029
//   bidi embeddings and overrides: U+202A to U+202E
//   invisible operators: U+2060 to U+2064
//   bidi isolates: U+2066 to U+2069
//   byte order mark / zero-width no-break space: U+FEFF
const RANGES = "\u0000-\u0009\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF";
const UNSAFE = new RegExp(`[${RANGES}]`, "g");
const UNSAFE_ANY = new RegExp(`[${RANGES}]`); // no "g": test() keeps no state

const NAMED: Record<string, string> = { "\t": "\\t", "\r": "\\r" };

const hex = (code: number, width: number) => code.toString(16).padStart(width, "0");

function escapeChar(ch: string): string {
  const named = NAMED[ch];
  if (named) return named;
  const code = ch.charCodeAt(0);
  return code <= 0xff ? `\\x${hex(code, 2)}` : `\\u${hex(code, 4)}`;
}

// Shown on screen: control and invisible characters become visible escapes
export function forTerminal(text: string): string {
  return text.replace(UNSAFE, escapeChar);
}

// True if the text holds anything forTerminal would escape. Used to
// REJECT inputs to an external write before a human is asked, since
// an id or a message with hidden characters has no honest use.
export function hasControlChars(text: string): boolean {
  return UNSAFE_ANY.test(text);
}

// For a JSON line (a trace): JSON.stringify already escapes C0
// controls, but leaves C1, bidi and invisible characters raw. This
// writes them as JSON \u escapes too, so the line is still valid
// JSON with the same value, and grepping it in a terminal shows them.
export function jsonSafe(json: string): string {
  return json.replace(UNSAFE, (ch) => `\\u${hex(ch.charCodeAt(0), 4)}`);
}

// console.log for anything that may carry untrusted text
export function say(text: string): void {
  console.log(forTerminal(text));
}
