import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startupMessages } from "./startup-log";

describe("startup log", () => {
  it("prints localhost and LAN addresses when HOST is unset or a wildcard", () => {
    const expected = [
      "> Slophoot ready on http://localhost:3001 (production, socket.io attached)",
      "> Players on this network can open:",
      ">   http://172.30.0.2:3001",
    ];

    assert.deepEqual(
      startupMessages({ bindHost: undefined, port: 3001, dev: false, lan: ["172.30.0.2"] }),
      expected,
    );
    assert.deepEqual(
      startupMessages({ bindHost: "", port: 3001, dev: false, lan: ["172.30.0.2"] }),
      expected,
    );
    assert.deepEqual(
      startupMessages({ bindHost: "0.0.0.0", port: 3001, dev: false, lan: ["172.30.0.2"] }),
      expected,
    );
    assert.deepEqual(
      startupMessages({ bindHost: "::", port: 3001, dev: false, lan: ["172.30.0.2"] }),
      expected,
    );
    assert.deepEqual(
      startupMessages({ bindHost: "[::]", port: 3001, dev: false, lan: ["172.30.0.2"] }),
      expected,
    );
  });

  it("prints a specific bind address without the LAN list", () => {
    assert.deepEqual(
      startupMessages({
        bindHost: "127.0.0.1",
        port: 3000,
        dev: true,
        lan: ["172.30.0.2"],
      }),
      ["> Slophoot ready on http://127.0.0.1:3000 (development, socket.io attached)"],
    );
    assert.deepEqual(
      startupMessages({ bindHost: "::1", port: 3000, dev: false, lan: ["172.30.0.2"] }),
      ["> Slophoot ready on http://[::1]:3000 (production, socket.io attached)"],
    );
  });
});
