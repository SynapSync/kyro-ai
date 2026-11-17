/**
 * Declarative flag tables read by one small parser.
 *
 * A command declares its flags as a table of FlagSpec entries and calls parseFlags. Behavior that
 * does not fit a table (positionals, unknown-option wording, cross-flag rules) stays in the
 * command: positionals and unknown tokens go to the `fallback` callback, and cross-flag rules run
 * after the table parse.
 *
 * The parser reproduces the scan the hand-written parsers used: left to right, stop at the first
 * problem, exact-token match first, then `<name>=value`. A flag listed twice in the input is simply
 * applied twice, in order.
 */

/**
 * Decides what a value flag consumes. Receives the next token (undefined at the end of the list)
 * and the flag token as typed. Returns the value to consume, or null to leave the next token alone
 * (the flag then receives an empty string). Throws when the value is not acceptable.
 */
export type ValueTaker = (next: string | undefined, token: string) => string | null;

export interface FlagSpec<S> {
  /** Exact tokens that select the flag, for example ['--yes', '-y', '--confirm']. */
  readonly names: readonly string[];
  /** Absent for a boolean flag. */
  readonly take?: ValueTaker;
  /** Also accept `<name>=value` for every name (value flags only). */
  readonly inline?: boolean;
  readonly apply: (state: S, value: string, token: string) => void;
}

export function flag<S>(names: readonly string[], apply: (state: S) => void): FlagSpec<S> {
  return { names, apply: (state) => apply(state) };
}

export function option<S>(
  names: readonly string[],
  take: ValueTaker,
  apply: (state: S, value: string, token: string) => void,
  inline = false,
): FlagSpec<S> {
  return { names, take, inline, apply };
}

/** A value is required: the next token must exist and must not start with `--`. */
export function takeUnlessDashed(fail: (token: string) => Error): ValueTaker {
  return (next, token) => {
    if (next === undefined || next.startsWith('--')) throw fail(token);
    return next;
  };
}

/** A value is required: the next token must be present and non-empty (a leading `--` is accepted). */
export function takeNonEmpty(fail: (token: string) => Error): ValueTaker {
  return (next, token) => {
    if (!next) throw fail(token);
    return next;
  };
}

/** A value is required: the next token must be non-empty and must not start with `--`. */
export function takeNonEmptyUnlessDashed(fail: (token: string) => Error): ValueTaker {
  return (next, token) => {
    if (!next || next.startsWith('--')) throw fail(token);
    return next;
  };
}

/** The value is optional: a missing, empty, or `--`-leading next token is not consumed. */
export const takeIfPlain: ValueTaker = (next) => (!next || next.startsWith('--') ? null : next);

export function parseFlags<S>(
  specs: readonly FlagSpec<S>[],
  args: readonly string[],
  state: S,
  /** Called for every token no flag claims: positionals, unknown flags. Throws to reject. */
  fallback: (arg: string, state: S) => void,
): S {
  const exact = new Map<string, FlagSpec<S>>();
  const inline: Array<[string, FlagSpec<S>]> = [];
  for (const spec of specs) {
    for (const name of spec.names) {
      exact.set(name, spec);
      if (spec.inline) inline.push([`${name}=`, spec]);
    }
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const spec = exact.get(arg);
    if (spec) {
      if (!spec.take) {
        spec.apply(state, '', arg);
        continue;
      }
      const taken = spec.take(args[i + 1], arg);
      if (taken === null) {
        spec.apply(state, '', arg);
      } else {
        spec.apply(state, taken, arg);
        i += 1;
      }
      continue;
    }
    const prefixed = inline.find(([prefix]) => arg.startsWith(prefix));
    if (prefixed) prefixed[1].apply(state, arg.slice(prefixed[0].length), arg);
    else fallback(arg, state);
  }
  return state;
}

/** `--help` / `-h` for any state that carries a `help` boolean. */
export function helpFlag<S extends { help: boolean }>(): FlagSpec<S> {
  return flag<S>(['--help', '-h'], (state) => { state.help = true; });
}

/** `--dry-run` for any state that carries a `dryRun` boolean. */
export function dryRunFlag<S extends { dryRun: boolean }>(): FlagSpec<S> {
  return flag<S>(['--dry-run'], (state) => { state.dryRun = true; });
}
