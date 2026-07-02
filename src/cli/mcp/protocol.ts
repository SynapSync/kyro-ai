export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface JsonRpcRequest { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: unknown }
export interface JsonRpcResponse { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

export function isRequest(value: unknown): value is JsonRpcRequest {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (value as { jsonrpc?: unknown }).jsonrpc === '2.0'
    && typeof (value as { method?: unknown }).method === 'string';
}
