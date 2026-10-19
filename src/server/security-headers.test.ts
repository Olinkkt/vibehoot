import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { Server } from "socket.io";
import type { IncomingMessage } from "node:http";
import { SECURITY_HEADERS, applySecurityHeaders, isSocketIoRequest } from "./security-headers";

function request(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

describe("security headers", () => {
  it("sets the proxy-facing headers and leaves socket.io requests alone", () => {
    const byKey = new Map(SECURITY_HEADERS.map((header) => [header.key, header.value]));
    assert.equal(byKey.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
    assert.equal(byKey.get("X-Content-Type-Options"), "nosniff");
    assert.equal(byKey.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.equal(byKey.get("Content-Security-Policy"), "frame-ancestors 'none'");
    assert.equal(byKey.get("X-Frame-Options"), "DENY");

    assert.equal(isSocketIoRequest(request("/socket.io/?EIO=4&transport=websocket")), true);
    assert.equal(isSocketIoRequest(request("/socket.io/")), true);
    assert.equal(isSocketIoRequest(request("/socket.io")), false);
    assert.equal(isSocketIoRequest(request("/socket.io?foo=bar")), false);
    assert.equal(isSocketIoRequest(request("/host")), false);
    assert.equal(isSocketIoRequest(request("/")), false);
  });

  it("responds quickly to GET /socket.io without hanging", async () => {
    const httpServer = createServer((req, res) => {
      if (isSocketIoRequest(req)) {
        return;
      }
      applySecurityHeaders(res);
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("not found");
    });
    const io = new Server(httpServer);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("expected a TCP port");
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const start = Date.now();
      const response = await fetch(`http://127.0.0.1:${address.port}/socket.io`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      const elapsed = Date.now() - start;

      assert.equal(response.status, 404);
      assert.ok(elapsed < 1000, `Expected quick response, took ${elapsed}ms`);
      assert.equal(response.headers.get("x-frame-options"), "DENY");
    } finally {
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    }
  });
});
