import type { IncomingMessage } from "node:http";

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function readAllowedOrigins(
  envValue: string | undefined = process.env.ALLOWED_ORIGINS,
): string[] {
  if (!envValue) {
    return [];
  }

  return envValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function isAllowedOrigin(
  originHeader: string | undefined,
  requestHost: string | undefined,
  allowedOrigins: readonly string[] = readAllowedOrigins(),
): boolean {
  if (originHeader === undefined) {
    return true;
  }

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }

  const normalizedOrigin = origin.origin.toLowerCase();
  if (allowedOrigins.some((allowed) => allowed.toLowerCase() === normalizedOrigin)) {
    return true;
  }

  return requestHost !== undefined && origin.host.toLowerCase() === requestHost.toLowerCase();
}

export function socketAllowRequest(
  request: IncomingMessage,
  callback: (error: string | null | undefined, success: boolean) => void,
): void {
  callback(
    null,
    isAllowedOrigin(headerValue(request.headers.origin), headerValue(request.headers.host)),
  );
}
