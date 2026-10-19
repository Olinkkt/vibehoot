import { HOST_ERRORS } from "../shared/validation";

export type CreateLimiterOptions = {
  cooldownMs?: number;
  maxPerIp?: number;
  now?: () => number;
};

export type AcquireResult =
  | { ok: true; reserved: boolean }
  | { ok: false; message: string };

export type CreateLimiter = {
  tryAcquire: (socketId: string, ip: string) => AcquireResult;
  release: (socketId: string) => void;
};

const DEFAULT_COOLDOWN_MS = 1_000;
const DEFAULT_MAX_PER_IP = 20;

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createCreateLimiter(options: CreateLimiterOptions = {}): CreateLimiter {
  const cooldownMs =
    options.cooldownMs ?? positiveInt(process.env.HOST_CREATE_COOLDOWN_MS, DEFAULT_COOLDOWN_MS);
  const maxPerIp =
    options.maxPerIp ?? positiveInt(process.env.HOST_CREATE_MAX_PER_IP, DEFAULT_MAX_PER_IP);
  const now = options.now ?? (() => Date.now());
  const lastCreateAt = new Map<string, number>();
  const ipBySocket = new Map<string, string>();
  const roomsByIp = new Map<string, number>();

  function tryAcquire(socketId: string, ip: string): AcquireResult {
    const current = now();
    const previous = lastCreateAt.get(socketId);
    if (previous !== undefined && current - previous < cooldownMs) {
      return { ok: false, message: HOST_ERRORS.tooFast };
    }

    const alreadyHosting = ipBySocket.has(socketId);
    if (!alreadyHosting) {
      const count = roomsByIp.get(ip) ?? 0;
      if (count >= maxPerIp) {
        return { ok: false, message: HOST_ERRORS.tooMany };
      }
      roomsByIp.set(ip, count + 1);
      ipBySocket.set(socketId, ip);
    }

    lastCreateAt.set(socketId, current);
    return { ok: true, reserved: !alreadyHosting };
  }

  function release(socketId: string): void {
    const ip = ipBySocket.get(socketId);
    if (!ip) {
      return;
    }

    ipBySocket.delete(socketId);
    const nextCount = (roomsByIp.get(ip) ?? 1) - 1;
    if (nextCount <= 0) {
      roomsByIp.delete(ip);
    } else {
      roomsByIp.set(ip, nextCount);
    }
  }

  return { tryAcquire, release };
}
