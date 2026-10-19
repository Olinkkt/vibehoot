import type { IncomingMessage, ServerResponse } from "node:http";

export type SecurityHeader = {
  key: string;
  value: string;
};

export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

export function applySecurityHeaders(response: ServerResponse): void {
  for (const header of SECURITY_HEADERS) {
    response.setHeader(header.key, header.value);
  }
}

export function isSocketIoRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? "";
  return path.startsWith("/socket.io/");
}
