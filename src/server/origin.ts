import type { IncomingMessage } from "node:http";

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function readList(envValue: string | undefined): string[] {
  if (!envValue) {
    return [];
  }

  return envValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function readAllowedOrigins(
  envValue: string | undefined = process.env.ALLOWED_ORIGINS,
): string[] {
  return readList(envValue);
}

export function readAllowedHosts(envValue: string | undefined = process.env.ALLOWED_HOSTS): string[] {
  return readList(envValue);
}

type HostParts = {
  name: string;
  port: string | null;
};

function splitHost(value: string): HostParts {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) {
      return { name: trimmed, port: null };
    }

    const name = trimmed.slice(1, end);
    const rest = trimmed.slice(end + 1);
    if (rest.startsWith(":")) {
      return { name, port: rest.slice(1) };
    }
    return { name, port: null };
  }

  const firstColon = trimmed.indexOf(":");
  const lastColon = trimmed.lastIndexOf(":");
  if (firstColon === -1 || firstColon !== lastColon) {
    return { name: trimmed, port: null };
  }

  return { name: trimmed.slice(0, firstColon), port: trimmed.slice(firstColon + 1) };
}

export function isAllowedHost(
  requestHost: string | undefined,
  allowedHosts: readonly string[] = readAllowedHosts(),
): boolean {
  if (allowedHosts.length === 0) {
    return true;
  }

  if (requestHost === undefined || requestHost.trim().length === 0) {
    return false;
  }

  const request = splitHost(requestHost);
  if (request.name.length === 0) {
    return false;
  }

  return allowedHosts.some((allowed) => {
    const entry = splitHost(allowed);
    if (entry.name.length === 0) {
      return false;
    }
    if (entry.port !== null) {
      return entry.name === request.name && entry.port === request.port;
    }
    return entry.name === request.name;
  });
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
  const requestHost = headerValue(request.headers.host);
  callback(
    null,
    isAllowedHost(requestHost) &&
      isAllowedOrigin(headerValue(request.headers.origin), requestHost),
  );
}
