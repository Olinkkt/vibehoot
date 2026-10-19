import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IncomingMessage } from "node:http";
import { SECURITY_HEADERS, isSocketIoRequest } from "./security-headers";

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
    assert.equal(isSocketIoRequest(request("/host")), false);
    assert.equal(isSocketIoRequest(request("/")), false);
  });
});
