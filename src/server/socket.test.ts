import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";
import { Server } from "socket.io";
import { io as ioClient, type Socket } from "socket.io-client";
import type { ClientToServerEvents, LobbyUpdate, ServerToClientEvents } from "../shared/events";
import { createRoomStore } from "./rooms";
import { attachGameServer } from "./socket";

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

function waitFor<T>(socket: TestClient, event: string): Promise<T> {
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

function connect(port: number): Promise<TestClient> {
  const socket: TestClient = ioClient(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    forceNew: true,
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
  store: ReturnType<typeof createRoomStore>,
  run: (port: number, io: GameServer) => Promise<void>,
): Promise<void> {
  const httpServer = createServer();
  const io: GameServer = new Server(httpServer);
  attachGameServer(io, store);
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
      assert.equal(io.sockets.sockets.get(quinn.id)?.rooms.has("room:1111"), false);
      assert.equal(io.sockets.sockets.get(hostA.id)?.rooms.has("room:1111"), false);
      assert.equal(store.join("1111", "Late", "player-late").ok, false);
    });
  });
});
