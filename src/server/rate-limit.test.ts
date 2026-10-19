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
});
