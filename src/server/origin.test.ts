import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { Server } from "socket.io";
import { io as ioClient } from "socket.io-client";
import type { IncomingMessage } from "node:http";
import { isAllowedHost, isAllowedOrigin, socketAllowRequest } from "./origin";

describe("socket origin allowlist", () => {
  it("allows a missing origin, the request host, and configured origins", () => {
    const allowed = ["https://quiz.example"];
    assert.equal(isAllowedOrigin(undefined, "localhost:3000", allowed), true);
    assert.equal(isAllowedOrigin("http://localhost:3000", "localhost:3000", allowed), true);
    assert.equal(isAllowedOrigin("https://quiz.example", "internal:3000", allowed), true);
    assert.equal(isAllowedOrigin("https://evil.example", "localhost:3000", allowed), false);
    assert.equal(isAllowedOrigin("not a url", "localhost:3000", allowed), false);
  });

  it("allows every host when ALLOWED_HOSTS is empty and matches the list when it is set", () => {
    assert.equal(isAllowedHost("evil.example:3001", []), true);
    assert.equal(isAllowedHost(undefined, []), true);

    const allowed = ["localhost", "127.0.0.1", "quiz.example:3000", "[::1]"];
    assert.equal(isAllowedHost("localhost:3000", allowed), true);
    assert.equal(isAllowedHost("LOCALHOST", allowed), true);
    assert.equal(isAllowedHost("127.0.0.1:3000", allowed), true);
    assert.equal(isAllowedHost("quiz.example:3000", allowed), true);
    assert.equal(isAllowedHost("quiz.example:3001", allowed), false);
    assert.equal(isAllowedHost("[::1]:3000", allowed), true);
    assert.equal(isAllowedHost("evil.example:3001", allowed), false);
    assert.equal(isAllowedHost(undefined, allowed), false);
    assert.equal(isAllowedHost("   ", allowed), false);
  });

  it("rejects a socket handshake whose host is outside ALLOWED_HOSTS", () => {
    const previous = process.env.ALLOWED_HOSTS;
    process.env.ALLOWED_HOSTS = "localhost,127.0.0.1";

    const decide = (headers: IncomingMessage["headers"]): boolean => {
      let allowed = false;
      const request = { headers } as IncomingMessage;
      socketAllowRequest(request, (_error, success) => {
        allowed = success;
      });
      return allowed;
    };

    try {
      assert.equal(
        decide({ host: "evil.example:3001", origin: "http://evil.example:3001" }),
        false,
      );
      assert.equal(decide({ host: "localhost:3000", origin: "https://evil.example" }), false);
      assert.equal(
        decide({ host: "localhost:3000", origin: "http://localhost:3000" }),
        true,
      );
      assert.equal(decide({ host: "127.0.0.1:3000" }), true);
    } finally {
      if (previous === undefined) {
        delete process.env.ALLOWED_HOSTS;
      } else {
        process.env.ALLOWED_HOSTS = previous;
      }
    }
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
