import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { Server } from "socket.io";
import { io as ioClient } from "socket.io-client";
import { isAllowedOrigin, socketAllowRequest } from "./origin";

describe("socket origin allowlist", () => {
  it("allows a missing origin, the request host, and configured origins", () => {
    const allowed = ["https://quiz.example"];
    assert.equal(isAllowedOrigin(undefined, "localhost:3000", allowed), true);
    assert.equal(isAllowedOrigin("http://localhost:3000", "localhost:3000", allowed), true);
    assert.equal(isAllowedOrigin("https://quiz.example", "internal:3000", allowed), true);
    assert.equal(isAllowedOrigin("https://evil.example", "localhost:3000", allowed), false);
    assert.equal(isAllowedOrigin("not a url", "localhost:3000", allowed), false);
  });

  it("rejects a websocket connection from a foreign origin", { timeout: 5000 }, async () => {
    const httpServer = createServer();
    const io = new Server(httpServer, { allowRequest: socketAllowRequest });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("expected a TCP port");
    }

    const url = `http://127.0.0.1:${address.port.toString()}`;
    const allowed = ioClient(url, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      autoConnect: false,
      extraHeaders: { Origin: url },
    });
    const denied = ioClient(url, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      autoConnect: false,
      extraHeaders: { Origin: "https://evil.example" },
    });

    const allowedResult = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out connecting")), 2000);
      allowed.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      allowed.once("connect_error", (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const deniedResult = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("foreign origin was not refused")), 2000);
      denied.once("connect", () => {
        clearTimeout(timer);
        reject(new Error("foreign origin was accepted"));
      });
      denied.once("connect_error", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    try {
      allowed.connect();
      denied.connect();
      await Promise.all([allowedResult, deniedResult]);
    } finally {
      allowed.close();
      denied.close();
      await new Promise<void>((resolve) => {
        io.close(() => {
          resolve();
        });
      });
    }
  });
});
