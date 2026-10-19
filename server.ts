import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { parse } from "node:url";
import next from "next";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./src/shared/events";
import { socketAllowRequest } from "./src/server/origin";
import { attachGameServer } from "./src/server/socket";

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

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
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

function formatHost(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
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
    const mode = dev ? "development" : "production";
    const shownHost = bindHost && bindHost.length > 0 ? formatHost(bindHost) : "localhost";
    console.log(
      `> Slophoot ready on http://${shownHost}:${port.toString()} (${mode}, socket.io attached)`,
    );
    if (bindHost && bindHost.length > 0) {
      return;
    }

    const lan = lanAddresses();
    if (lan.length === 0) {
      return;
    }

    console.log("> Players on this network can open:");
    for (const address of lan) {
      console.log(`>   http://${address}:${port.toString()}`);
    }
  };

  if (bindHost && bindHost.length > 0) {
    httpServer.listen(port, bindHost, onListening);
    return;
  }

  httpServer.listen(port, onListening);
});
