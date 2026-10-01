// ============================================================
// TERMINAL-SAFE TEXT
// ============================================================
// Model output and customer data are shown in the terminal: in the
// approval box, the 💭 lines, ask_human questions and chat replies.
// WHY escape them: a terminal obeys control characters. A carriage
// return (\r) can overwrite a line the human already read, an ESC
// sequence can clear the screen or recolour text, and Unicode bidi
// overrides can make "approve A" render as "approve B". Any of these
// could hide or fake what a human is approving.
//
// The fix: every control character except the newline is shown as
// a visible escape (\r, \x1b, ‮) instead of being obeyed. The
// text still reads fine; it just can't steer the terminal.
// ============================================================

// C0 controls except \n (0x0A), DEL, C1 controls, and the Unicode
// bidi controls: marks (U+061C, U+200E, U+200F), embeddings and
// overrides (U+202A to U+202E) and isolates (U+2066 to U+2069).
const UNSAFE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/g;

const NAMED: Record<string, string> = { "\t": "\\t", "\r": "\\r" };

function escapeChar(ch: string): string {
  const named = NAMED[ch];
  if (named) return named;
  const code = ch.charCodeAt(0);
  return code <= 0xff ? `\\x${code.toString(16).padStart(2, "0")}` : `\\u${code.toString(16).padStart(4, "0")}`;
}

// Shown on screen: control characters become visible escapes
export function forTerminal(text: string): string {
  return text.replace(UNSAFE, escapeChar);
}

// True if the text holds anything forTerminal would escape. Used to
// REJECT inputs to an external write before a human is asked, since
// an id or a message with hidden characters has no honest use.
const UNSAFE_ANY = new RegExp(UNSAFE.source); // no "g": test() keeps no state
export function hasControlChars(text: string): boolean {
  return UNSAFE_ANY.test(text);
}

// console.log for anything that may carry untrusted text
export function say(text: string): void {
  console.log(forTerminal(text));
}
