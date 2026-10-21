import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { parse } from "node:url";
import next from "next";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./src/shared/events";
import { isAllowedHost, socketAllowRequest } from "./src/server/origin";
import { applySecurityHeaders, isSocketIoRequest } from "./src/server/security-headers";
import { attachGameServer } from "./src/server/socket";
import { startupMessages } from "./src/server/startup-log";

const dev = process.env.NODE_ENV !== "production";
const bindHost = process.env.HOST;
const hostname = bindHost && bindHost.length > 0 ? bindHost : "localhost";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT: ${process.env.PORT ?? ""}`);
}

const httpServer = createServer((request, response) => {
  void handleRequest(request, response);
});

const app = next({ dev, hostname, port, httpServer });
const handle = app.getRequestHandler();

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  allowRequest: socketAllowRequest,
  // Drop half-open host sockets in about 15s instead of the 45s engine default.
  pingInterval: 10_000,
  pingTimeout: 5_000,
});
attachGameServer(io);

io.engine.on("connection_error", (error: unknown) => {
  console.error(connectionErrorLine(error));
});

const MAX_CONNECTION_ERROR_MESSAGE = 300;

function connectionErrorLine(error: unknown): string {
  let code = "unknown";
  let message = "unknown";
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: unknown; message?: unknown };
    if (typeof record.code === "number" || typeof record.code === "string") {
      code = String(record.code);
    }
    if (typeof record.message === "string" && record.message.trim().length > 0) {
      message = record.message;
    }
  }

  const oneLine = message.replaceAll(/[\r\n]+/g, " ").slice(0, MAX_CONNECTION_ERROR_MESSAGE);
  return `Socket.io connection error code=${code} message=${oneLine}`;
}

function requestHost(request: IncomingMessage): string | undefined {
  const value = request.headers.host;
  return Array.isArray(value) ? value[0] : value;
}

function isHealthCheckRequest(request: IncomingMessage): boolean {
  if (request.method !== "GET") {
    return false;
  }

  const path = (request.url ?? "").split("?", 1)[0] ?? "";
  return path === "/api/health" || path === "/api/health/";
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (isSocketIoRequest(request)) {
    return;
  }

  applySecurityHeaders(response);

  try {
    // Coolify curls localhost from inside the container. That host is not the
    // public ALLOWED_HOSTS entry, so the probe must still reach the route.
    if (!isHealthCheckRequest(request) && !isAllowedHost(requestHost(request))) {
      response.statusCode = 403;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end("forbidden");
      return;
    }

    const parsedUrl = parse(request.url ?? "/", true);
    await handle(request, response, parsedUrl);
  } catch (error: unknown) {
    console.error("Failed to handle request", request.url, error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end("internal server error");
    }
  }
}

function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  return addresses;
}

void app.prepare().then(() => {
  const onListening = () => {
    for (const line of startupMessages({
      bindHost,
      port,
      dev,
      lan: lanAddresses(),
    })) {
      console.log(line);
    }
  };

  if (bindHost && bindHost.length > 0) {
    httpServer.listen(port, bindHost, onListening);
    return;
  }

  httpServer.listen(port, onListening);
});
