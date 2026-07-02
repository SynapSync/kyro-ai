import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import type { JsonRpcResponse } from './protocol';

export type MessageHandler = (message: unknown) => void;

export function startJsonRpcLoop(onMessage: MessageHandler): void {
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (line.trim().length === 0) return;
    try {
      onMessage(JSON.parse(line) as unknown);
    } catch (error: unknown) {
      sendError(null, -32700, 'Parse error', error instanceof Error ? error.message : String(error));
    }
  });
}

export function sendResult(id: string | number | null, result: unknown): void {
  write({ jsonrpc: '2.0', id, result });
}

export function sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
  write({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

function write(message: JsonRpcResponse): void {
  output.write(`${JSON.stringify(message)}\n`);
}
