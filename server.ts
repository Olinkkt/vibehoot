import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parse } from "node:url";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "localhost";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT: ${process.env.PORT ?? ""}`);
}

const httpServer = createServer((request, response) => {
  void handleRequest(request, response);
});

const app = next({ dev, hostname, port, httpServer });
const handle = app.getRequestHandler();

const io = new Server(httpServer);

io.engine.on("connection_error", (error: unknown) => {
  console.error("Socket.io connection error", error);
});

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

void app.prepare().then(() => {
  httpServer.listen(port, () => {
    const mode = dev ? "development" : "production";
    console.log(
      `> Slophoot ready on http://${hostname}:${port} (${mode}, socket.io attached)`,
    );
  });
});
