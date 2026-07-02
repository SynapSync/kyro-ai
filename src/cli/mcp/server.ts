import { readPackageVersion } from '../help';
import { callTool, listTools } from './handlers';
import { sendError, sendResult, startJsonRpcLoop } from './jsonrpc';
import { MCP_PROTOCOL_VERSION, isRequest } from './protocol';

let initialized = false;
let initializeResponded = false;

export function serveMcp(): void {
  startJsonRpcLoop((message) => handleMessage(message));
}

function handleMessage(message: unknown): void {
  if (Array.isArray(message)) {
    sendError(null, -32600, 'Batch requests are not supported');
    return;
  }
  if (!isRequest(message)) {
    // Accept notifications/responses as no-op only if they look like JSON-RPC without method id response.
    if (isInitializedNotification(message)) {
      initialized = true;
      return;
    }
    sendError(null, -32600, 'Invalid Request');
    return;
  }

  const id = message.id ?? null;
  if (message.method === 'notifications/initialized') {
    initialized = true;
    return;
  }
  if (message.method === 'initialize') {
    initializeResponded = true;
    const requested = requestedProtocolVersion(message.params);
    sendResult(id, {
      protocolVersion: requested === MCP_PROTOCOL_VERSION ? requested : MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'kyro', version: readPackageVersion() },
    });
    return;
  }
  if (!initializeResponded && message.method !== 'ping') {
    sendError(id, -32002, 'Server not initialized');
    return;
  }
  switch (message.method) {
    case 'ping':
      sendResult(id, {});
      return;
    case 'tools/list':
      sendResult(id, listTools());
      return;
    case 'tools/call':
      sendResult(id, handleToolCall(message.params));
      return;
    default:
      sendError(id, -32601, `Method not found: ${message.method}`);
  }
}

function handleToolCall(params: unknown): unknown {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return callTool('__invalid__', {});
  }
  const p = params as { name?: unknown; arguments?: unknown };
  if (typeof p.name !== 'string') return callTool('__invalid__', {});
  return callTool(p.name, p.arguments ?? {});
}

function requestedProtocolVersion(params: unknown): string | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  const value = (params as { protocolVersion?: unknown }).protocolVersion;
  return typeof value === 'string' ? value : null;
}

function isInitializedNotification(message: unknown): boolean {
  return typeof message === 'object' && message !== null && !Array.isArray(message)
    && (message as { jsonrpc?: unknown }).jsonrpc === '2.0'
    && (message as { method?: unknown }).method === 'notifications/initialized';
}

void initialized;
