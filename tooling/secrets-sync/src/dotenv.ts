/**
 * The dotenv file format, as one parser and one serializer.
 *
 * There used to be two parsers — one inlined in `env-pull.sh`, one in
 * `env-push.sh` — and they disagreed: pull stripped the surrounding quotes and
 * stopped, push also unescaped `\n`, `\"` and `\\`. So a value containing a
 * newline survived a push and came back mangled on the next pull, which is to
 * say the two halves of one tool did not agree on their own file format.
 *
 * There is one parser now, and it is the exact inverse of the serializer.
 */

/** A dotenv file reduced to its key/value pairs, in file order. */
export type EnvRecord = Record<string, string>;

/**
 * A dotenv assignment. The key grammar is deliberately narrow — a shell
 * identifier — because that is what every consumer of these files (`dotenv-cli`,
 * compose, `process.env`) can actually read back.
 */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** A value safe to write bare: no quoting, no escaping, no ambiguity. */
const BARE_VALUE = /^[A-Za-z0-9_./:-]*$/;

/**
 * The escapes the serializer emits, and therefore the only ones the parser
 * recognises. `\n` becomes a newline; `\"` and `\\` stand for themselves.
 * Anything else keeps its backslash, so a hand-written `\t` stays two
 * characters rather than silently becoming a tab.
 */
const ESCAPE = /\\(.)/g;

function unescapeValue(raw: string) {
  return raw.replace(ESCAPE, (match, char: string) => {
    if (char === 'n') return '\n';
    if (char === '"' || char === '\\') return char;
    return match;
  });
}

function escapeValue(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Read a dotenv file's text into a record. Comments, blank lines and anything
 * that is not an assignment are skipped; a repeated key takes its last value,
 * which is what every dotenv reader does.
 */
export function parseEnvFile(text: string): EnvRecord {
  const env: EnvRecord = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = ASSIGNMENT.exec(trimmed);
    if (!match?.[1]) continue;
    const value = match[2] ?? '';
    const quoted = /^"(.*)"$/.exec(value);
    env[match[1]] =
      quoted?.[1] === undefined ? value : unescapeValue(quoted[1]);
  }
  return env;
}

/**
 * Write a record back out as dotenv text, one assignment per line in record
 * order, with a trailing newline.
 *
 * Keys are written verbatim. A key outside the assignment grammar cannot be
 * read back — but it can only reach here from a vault whose env file has no
 * `.example` to declare its keys, and dropping someone's value silently is
 * worse than writing a line they can see.
 */
export function serializeEnv(env: EnvRecord): string {
  const lines = Object.entries(env).map(([key, value]) =>
    BARE_VALUE.test(value)
      ? `${key}=${value}`
      : `${key}="${escapeValue(value)}"`,
  );
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
