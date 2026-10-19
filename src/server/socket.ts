import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  LobbyUpdate,
  PlayerJoinPayload,
  ServerToClientEvents,
} from "../shared/events";
import { HOST_ERRORS, JOIN_ERRORS } from "../shared/validation";
import { createCreateLimiter, type CreateLimiter } from "./rate-limit";
import {
  NO_FREE_PIN_MESSAGE,
  createRoomStore,
  type DisconnectResult,
  type Room,
  type RoomStore,
} from "./rooms";

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const rooms = createRoomStore();

function channel(pin: string): string {
  return `room:${pin}`;
}

function toLobby(room: Room): LobbyUpdate {
  return {
    pin: room.pin,
    players: room.players.map((player) => ({ nickname: player.nickname })),
  };
}

function isJoinPayload(payload: unknown): payload is PlayerJoinPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return typeof record.pin === "string" && typeof record.nickname === "string";
}

function closeChannel(io: GameServer, pin: string, except?: GameSocket): void {
  const roomChannel = channel(pin);
  const target = except ? except.to(roomChannel) : io.to(roomChannel);
  target.emit("room:closed");
  io.in(roomChannel).socketsLeave(roomChannel);
}

function announceDisplacement(
  io: GameServer,
  socket: GameSocket,
  displaced: DisconnectResult,
): void {
  if (displaced.type === "room_closed") {
    closeChannel(io, displaced.pin, socket);
    return;
  }

  if (displaced.type === "player_left") {
    const roomChannel = channel(displaced.room.pin);
    void socket.leave(roomChannel);
    io.to(roomChannel).emit("lobby:update", toLobby(displaced.room));
  }
}

function clientAddress(socket: GameSocket): string {
  const address = socket.handshake.address.trim();
  return address.length > 0 ? address : "unknown";
}

export function attachGameServer(
  io: GameServer,
  store: RoomStore = rooms,
  limiter: CreateLimiter = createCreateLimiter(),
): void {
  io.on("connection", (socket) => {
    socket.on("host:create", () => {
      const decision = limiter.tryAcquire(socket.id, clientAddress(socket));
      if (!decision.ok) {
        socket.emit("host:error", { message: decision.message });
        return;
      }

      try {
        const { room, displaced } = store.createRoom(socket.id);
        announceDisplacement(io, socket, displaced);
        void socket.join(channel(room.pin));
        socket.emit("lobby:update", toLobby(room));
      } catch (error: unknown) {
        if (decision.reserved) {
          limiter.release(socket.id);
        }
        if (!(error instanceof Error) || error.message !== NO_FREE_PIN_MESSAGE) {
          console.error("Failed to create room", error);
        }
        socket.emit("host:error", { message: HOST_ERRORS.noRooms });
      }
    });

    socket.on("player:join", (payload: PlayerJoinPayload) => {
      if (!isJoinPayload(payload)) {
        socket.emit("join:error", { message: JOIN_ERRORS.invalidRequest });
        return;
      }

      const result = store.join(payload.pin, payload.nickname, socket.id);
      if (!result.ok) {
        socket.emit("join:error", { message: result.message });
        return;
      }

      if (result.closedPin) {
        limiter.release(socket.id);
        closeChannel(io, result.closedPin, socket);
      }

      if (result.previousRoom) {
        const previousChannel = channel(result.previousRoom.pin);
        void socket.leave(previousChannel);
        io.to(previousChannel).emit("lobby:update", toLobby(result.previousRoom));
      }

      const roomChannel = channel(result.room.pin);
      void socket.join(roomChannel);
      io.to(roomChannel).emit("lobby:update", toLobby(result.room));
    });

    socket.on("disconnect", () => {
      const result = store.disconnect(socket.id);
      limiter.forget(socket.id);
      if (result.type === "room_closed") {
        closeChannel(io, result.pin);
        return;
      }

      if (result.type === "player_left") {
        io.to(channel(result.room.pin)).emit("lobby:update", toLobby(result.room));
      }
    });
  });
}
