import { env, stdin as input, stdout as output } from 'node:process';

/**
 * Whether an interactive prompt can actually be answered. Commands that gate an irreversible write
 * behind a confirmation must check this first: in an agent harness, CI, or a piped shell, prompting
 * blocks on stdin that never arrives, so the caller must fail fast with a remedy instead.
 *
 * `KYRO_TEST_ASSUME_TTY=1` forces the interactive answer (same KYRO_TEST_* convention the writer-lock
 * hooks use). Tests need it to drive the prompt over a pipe — notably the invariant that an awaiting
 * confirmation never holds the state-writer lock, which is only observable while a prompt is open.
 * It cannot skip a confirmation, only reach one: the answer is still required.
 */
export function isInteractiveTerminal(): boolean {
  if (env.KYRO_TEST_ASSUME_TTY === '1') return true;
  return input.isTTY === true && output.isTTY === true;
}
