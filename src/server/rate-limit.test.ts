import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOST_ERRORS } from "../shared/validation";
import { createCreateLimiter } from "./rate-limit";

describe("host create limiter", () => {
  it("enforces a per-socket cooldown and a per-IP cap", () => {
    let now = 1_000;
    const limiter = createCreateLimiter({
      cooldownMs: 1_000,
      maxPerIp: 2,
      now: () => now,
    });

    assert.deepEqual(limiter.tryAcquire("socket-1", "10.0.0.8"), { ok: true, reserved: true });
    assert.deepEqual(limiter.tryAcquire("socket-1", "10.0.0.8"), {
      ok: false,
      message: HOST_ERRORS.tooFast,
    });

    now += 1_000;
    assert.deepEqual(limiter.tryAcquire("socket-1", "10.0.0.8"), { ok: true, reserved: false });
    assert.deepEqual(limiter.tryAcquire("socket-2", "10.0.0.8"), { ok: true, reserved: true });
    assert.deepEqual(limiter.tryAcquire("socket-3", "10.0.0.8"), {
      ok: false,
      message: HOST_ERRORS.tooMany,
    });

    limiter.release("socket-2");
    assert.deepEqual(limiter.tryAcquire("socket-3", "10.0.0.8"), { ok: true, reserved: true });
    limiter.release("socket-1");
    limiter.release("socket-1");
    assert.deepEqual(limiter.tryAcquire("socket-4", "10.0.0.9"), { ok: true, reserved: true });
  });

  it("keeps the cooldown after release and drops it on forget", () => {
    let now = 5_000;
    const limiter = createCreateLimiter({
      cooldownMs: 1_000,
      maxPerIp: 2,
      now: () => now,
    });

    assert.equal(limiter.tryAcquire("socket-1", "10.0.0.1").ok, true);
    assert.equal(limiter.tryAcquire("socket-2", "10.0.0.2").ok, true);
    assert.deepEqual(limiter.sizes(), { timestamps: 2, sockets: 2, ips: 2 });

    limiter.release("socket-1");
    assert.deepEqual(limiter.sizes(), { timestamps: 2, sockets: 1, ips: 1 });
    assert.deepEqual(limiter.tryAcquire("socket-1", "10.0.0.1"), {
      ok: false,
      message: HOST_ERRORS.tooFast,
    });

    limiter.forget("socket-1");
    limiter.forget("socket-2");
    assert.deepEqual(limiter.sizes(), { timestamps: 0, sockets: 0, ips: 0 });

    now += 1;
    assert.deepEqual(limiter.tryAcquire("socket-1", "10.0.0.1"), { ok: true, reserved: true });
    limiter.forget("missing");
    assert.deepEqual(limiter.sizes(), { timestamps: 1, sockets: 1, ips: 1 });
  });
});
