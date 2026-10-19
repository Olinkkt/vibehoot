import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";
import { Server } from "socket.io";
import { io as ioClient, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  HostErrorPayload,
  HostReadyPayload,
  LobbyUpdate,
  ServerToClientEvents,
} from "../shared/events";
import { HOST_ERRORS, JOIN_ERRORS } from "../shared/validation";
import { createCreateLimiter, type CreateLimiter } from "./rate-limit";
import { NO_FREE_PIN_MESSAGE, createRoomStore, type RoomStore } from "./rooms";
import { attachGameServer, type AttachOptions } from "./socket";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

function pins(...values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

function waitFor<T>(socket: TestClient, event: keyof ServerToClientEvents): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${event}`));
    }, 2000);
    socket.once(event, (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args[0] as T);
    });
  });
}

function socketId(socket: TestClient): string {
  const id = socket.id;
  if (!id) {
    throw new Error("socket is not connected");
  }
  return id;
}

function connect(port: number): Promise<TestClient> {
  const socket: TestClient = ioClient(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("timed out connecting"));
    }, 2000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error: Error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

async function withServer(
  store: RoomStore,
  run: (port: number, io: GameServer) => Promise<void>,
  limiter?: CreateLimiter,
  options?: AttachOptions,
): Promise<void> {
  const httpServer = createServer();
  const io: GameServer = new Server(httpServer);
  attachGameServer(io, store, limiter, options);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("expected the test server to listen on a TCP port");
  }

  try {
    await run(address.port, io);
  } finally {
    io.disconnectSockets(true);
    await new Promise<void>((resolve) => {
      io.close(() => {
        resolve();
      });
    });
  }
}

describe("game socket", () => {
  const openClients: TestClient[] = [];

  after(() => {
    for (const socket of openClients) {
      socket.close();
    }
  });

  it("tells players and frees the PIN when a host joins another room", { timeout: 5000 }, async () => {
    const store = createRoomStore({ randomPin: pins(1111, 2222) });

    await withServer(store, async (port, io) => {
      const hostA = await connect(port);
      const quinn = await connect(port);
      const hostB = await connect(port);
      openClients.push(hostA, quinn, hostB);

      const createdA = waitFor<LobbyUpdate>(hostA, "lobby:update");
      hostA.emit("host:create");
      assert.equal((await createdA).pin, "1111");

      const quinnJoined = waitFor<LobbyUpdate>(quinn, "lobby:update");
      quinn.emit("player:join", { pin: "1111", nickname: "Quinn" });
      assert.deepEqual((await quinnJoined).players.map((player) => player.nickname), ["Quinn"]);

      const createdB = waitFor<LobbyUpdate>(hostB, "lobby:update");
      hostB.emit("host:create");
      assert.equal((await createdB).pin, "2222");

      const closed = waitFor<undefined>(quinn, "room:closed");
      const joined = waitFor<LobbyUpdate>(hostA, "lobby:update");
      hostA.emit("player:join", { pin: "2222", nickname: "H2AsPlayer" });
      await closed;
      const lobby = await joined;

      assert.equal(lobby.pin, "2222");
      assert.deepEqual(
        lobby.players.map((player) => player.nickname),
        ["H2AsPlayer"],
      );
      assert.equal(store.getRoom("1111"), null);
      assert.equal(io.sockets.sockets.get(socketId(quinn))?.rooms.has("room:1111"), false);
      assert.equal(io.sockets.sockets.get(socketId(hostA))?.rooms.has("room:1111"), false);
      assert.equal(store.join("1111", "Late", "player-late").ok, false);
    });
  });

  it("emits host:error when no PIN is free", { timeout: 5000 }, async () => {
    const store: RoomStore = {
      createRoom() {
        throw new Error(NO_FREE_PIN_MESSAGE);
      },
      join() {
        return { ok: false, message: JOIN_ERRORS.invalidRequest };
      },
      disconnect() {
        return { type: "none" };
      },
      suspendHost() {
        return { type: "none" };
      },
      resumeHost() {
        return { ok: false, message: HOST_ERRORS.roomGone, code: "expired" };
      },
      expireHost() {
        return { type: "none" };
      },
      isHostAway() {
        return false;
      },
      getRoom() {
        return null;
      },
    };

    await withServer(store, async (port) => {
      const host = await connect(port);
      openClients.push(host);
      const error = waitFor<HostErrorPayload>(host, "host:error");
      host.emit("host:create");
      assert.equal((await error).message, HOST_ERRORS.noRooms);
    });
  });

  it("rate-limits host:create per socket and per address", { timeout: 5000 }, async () => {
    const now = 5_000;
    const limiter = createCreateLimiter({
      cooldownMs: 1_000,
      maxPerIp: 1,
      now: () => now,
    });
    const store = createRoomStore({ randomPin: pins(4444, 5555) });

    await withServer(
      store,
      async (port) => {
        const first = await connect(port);
        const second = await connect(port);
        openClients.push(first, second);

        const created = waitFor<LobbyUpdate>(first, "lobby:update");
        first.emit("host:create");
        assert.equal((await created).pin, "4444");

        const cooled = waitFor<HostErrorPayload>(first, "host:error");
        first.emit("host:create");
        assert.equal((await cooled).message, HOST_ERRORS.tooFast);
        assert.equal(store.getRoom("4444")?.hostSocketId, socketId(first));

        const capped = waitFor<HostErrorPayload>(second, "host:error");
        second.emit("host:create");
        assert.equal((await capped).message, HOST_ERRORS.tooMany);
        assert.equal(store.getRoom("5555"), null);
      },
      limiter,
    );
  });

  it("removes players from the channel when the host disconnects", { timeout: 5000 }, async () => {
    const store = createRoomStore({ randomPin: () => 8463 });

    await withServer(store, async (port, io) => {
      const host = await connect(port);
      const player = await connect(port);
      openClients.push(host, player);

      const created = waitFor<LobbyUpdate>(host, "lobby:update");
      host.emit("host:create");
      await created;

      const joined = waitFor<LobbyUpdate>(player, "lobby:update");
      player.emit("player:join", { pin: "8463", nickname: "Ada" });
      await joined;
      assert.equal(io.sockets.sockets.get(socketId(player))?.rooms.has("room:8463"), true);

      const closed = waitFor<undefined>(player, "room:closed");
      host.disconnect();
      await closed;
      assert.equal(io.sockets.sockets.get(socketId(player))?.rooms.has("room:8463"), false);
      assert.equal(store.getRoom("8463"), null);
    }, undefined, { graceMs: 40 });
  });

  it("lets the same host reclaim the room during the grace period", { timeout: 5000 }, async () => {
    const store = createRoomStore({ randomPin: () => 4242 });

    await withServer(
      store,
      async (port) => {
        const host = await connect(port);
        const player = await connect(port);
        openClients.push(host, player);

        const ready = waitFor<HostReadyPayload>(host, "host:ready");
        const created = waitFor<LobbyUpdate>(host, "lobby:update");
        host.emit("host:create");
        const credentials = await ready;
        assert.equal((await created).pin, "4242");
        assert.equal(credentials.pin, "4242");
        assert.match(credentials.token, /^[a-f0-9]{32}$/);

        const joined = waitFor<LobbyUpdate>(player, "lobby:update");
        player.emit("player:join", { pin: "4242", nickname: "Ada" });
        await joined;

        let closed = false;
        player.on("room:closed", () => {
          closed = true;
        });

        const hostAway = waitFor<undefined>(player, "lobby:hostReconnecting");
        host.disconnect();
        await hostAway;
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(closed, false);
        assert.equal(store.isHostAway("4242"), true);
        assert.equal(store.getRoom("4242")?.players[0]?.nickname, "Ada");

        const latePlayer = await connect(port);
        openClients.push(latePlayer);
        const lateAway = waitFor<undefined>(latePlayer, "lobby:hostReconnecting");
        const lateJoined = waitFor<LobbyUpdate>(latePlayer, "lobby:update");
        latePlayer.emit("player:join", { pin: "4242", nickname: "Bea" });
        await lateJoined;
        await lateAway;

        const nextHost = await connect(port);
        openClients.push(nextHost);
        const hostBack = waitFor<undefined>(player, "lobby:hostReconnected");
        const resumedReady = waitFor<HostReadyPayload>(nextHost, "host:ready");
        const resumedLobby = waitFor<LobbyUpdate>(nextHost, "lobby:update");
        nextHost.emit("host:resume", { pin: credentials.pin, token: credentials.token });
        await hostBack;
        assert.equal((await resumedReady).token, credentials.token);
        const lobby = await resumedLobby;
        assert.equal(lobby.pin, "4242");
        assert.deepEqual(
          lobby.players.map((entry) => entry.nickname),
          ["Ada", "Bea"],
        );
        assert.equal(store.getRoom("4242")?.hostSocketId, socketId(nextHost));

        await new Promise((resolve) => setTimeout(resolve, 80));
        assert.equal(closed, false);
      },
      undefined,
      { graceMs: 400 },
    );
  });

  it("closes the room when the host does not return within the grace period", { timeout: 5000 }, async () => {
    const store = createRoomStore({ randomPin: () => 5150 });

    await withServer(
      store,
      async (port, io) => {
        const host = await connect(port);
        const player = await connect(port);
        openClients.push(host, player);

        const created = waitFor<LobbyUpdate>(host, "lobby:update");
        host.emit("host:create");
        await created;

        const joined = waitFor<LobbyUpdate>(player, "lobby:update");
        player.emit("player:join", { pin: "5150", nickname: "Ada" });
        await joined;

        const closed = waitFor<undefined>(player, "room:closed");
        host.disconnect();
        await closed;
        assert.equal(store.getRoom("5150"), null);
        assert.equal(io.sockets.sockets.get(socketId(player))?.rooms.has("room:5150"), false);

        const late = await connect(port);
        openClients.push(late);
        const error = waitFor<HostErrorPayload>(late, "host:error");
        late.emit("host:resume", { pin: "5150", token: "ab".repeat(16) });
        const lateError = await error;
        assert.equal(lateError.message, HOST_ERRORS.roomGone);
        assert.equal(lateError.code, "expired");
      },
      undefined,
      { graceMs: 40 },
    );
  });

  it("rejects a resume with the wrong host token", { timeout: 5000 }, async () => {
    const store = createRoomStore({ randomPin: () => 6161 });

    await withServer(
      store,
      async (port) => {
        const host = await connect(port);
        const player = await connect(port);
        openClients.push(host, player);

        const ready = waitFor<HostReadyPayload>(host, "host:ready");
        const created = waitFor<LobbyUpdate>(host, "lobby:update");
        host.emit("host:create");
        const credentials = await ready;
        await created;

        const joined = waitFor<LobbyUpdate>(player, "lobby:update");
        player.emit("player:join", { pin: "6161", nickname: "Ada" });
        await joined;

        host.disconnect();
        const nextHost = await connect(port);
        openClients.push(nextHost);
        const error = waitFor<HostErrorPayload>(nextHost, "host:error");
        nextHost.emit("host:resume", { pin: credentials.pin, token: "cd".repeat(16) });
        const rejected = await error;
        assert.equal(rejected.message, HOST_ERRORS.roomGone);
        assert.equal(rejected.code, "invalid");
        assert.equal(store.getRoom("6161")?.players[0]?.nickname, "Ada");
        assert.equal(store.getRoom("6161")?.hostSocketId, "");
      },
      undefined,
      { graceMs: 5_000 },
    );
  });

  it("lets a new socket take over while the old host socket is still connected", { timeout: 5000 }, async () => {
    const store = createRoomStore({ randomPin: () => 7373 });
    const limiter = createCreateLimiter({ cooldownMs: 0, maxPerIp: 1, now: () => 0 });

    await withServer(
      store,
      async (port) => {
        const host = await connect(port);
        const player = await connect(port);
        openClients.push(host, player);

        const ready = waitFor<HostReadyPayload>(host, "host:ready");
        const created = waitFor<LobbyUpdate>(host, "lobby:update");
        host.emit("host:create");
        const credentials = await ready;
        await created;

        const joined = waitFor<LobbyUpdate>(player, "lobby:update");
        player.emit("player:join", { pin: "7373", nickname: "Ada" });
        await joined;

        let closed = false;
        let away = false;
        player.on("room:closed", () => {
          closed = true;
        });
        player.on("lobby:hostReconnecting", () => {
          away = true;
        });

        const nextHost = await connect(port);
        openClients.push(nextHost);
        const oldGone = new Promise<void>((resolve) => {
          host.once("disconnect", () => {
            resolve();
          });
        });
        const resumedReady = waitFor<HostReadyPayload>(nextHost, "host:ready");
        const resumedLobby = waitFor<LobbyUpdate>(nextHost, "lobby:update");
        nextHost.emit("host:resume", { pin: credentials.pin, token: credentials.token });
        assert.equal((await resumedReady).token, credentials.token);
        assert.deepEqual(
          (await resumedLobby).players.map((entry) => entry.nickname),
          ["Ada"],
        );
        await oldGone;
        assert.equal(host.connected, false);
        assert.equal(store.getRoom("7373")?.hostSocketId, socketId(nextHost));

        await new Promise((resolve) => setTimeout(resolve, 250));
        assert.equal(closed, false);
        assert.equal(away, false);
        assert.equal(store.getRoom("7373")?.players[0]?.nickname, "Ada");

        const third = await connect(port);
        openClients.push(third);
        const capped = waitFor<HostErrorPayload>(third, "host:error");
        third.emit("host:create");
        assert.equal((await capped).message, HOST_ERRORS.tooMany);
        assert.equal(store.getRoom("7373")?.hostSocketId, socketId(nextHost));
      },
      limiter,
      { graceMs: 80 },
    );
  });

  it("removes players from the previous channel when the host creates again", { timeout: 5000 }, async () => {
    const store = createRoomStore({ randomPin: pins(1322, 2468) });
    const limiter = createCreateLimiter({ cooldownMs: 0, maxPerIp: 5, now: () => 0 });

    await withServer(
      store,
      async (port, io) => {
        const host = await connect(port);
        const player = await connect(port);
        openClients.push(host, player);

        const created = waitFor<LobbyUpdate>(host, "lobby:update");
        host.emit("host:create");
        assert.equal((await created).pin, "1322");

        const joined = waitFor<LobbyUpdate>(player, "lobby:update");
        player.emit("player:join", { pin: "1322", nickname: "Ada" });
        await joined;

        const closed = waitFor<undefined>(player, "room:closed");
        const nextLobby = waitFor<LobbyUpdate>(host, "lobby:update");
        host.emit("host:create");
        await closed;
        assert.equal((await nextLobby).pin, "2468");
        assert.equal(io.sockets.sockets.get(socketId(player))?.rooms.has("room:1322"), false);
        assert.equal(io.sockets.sockets.get(socketId(host))?.rooms.has("room:1322"), false);
        assert.equal(io.sockets.sockets.get(socketId(host))?.rooms.has("room:2468"), true);
      },
      limiter,
    );
  });
});
