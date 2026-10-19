import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  LobbyUpdate,
  PlayerJoinPayload,
  ServerToClientEvents,
} from "../shared/events";
import { JOIN_ERRORS } from "../shared/validation";
import { createRoomStore, type DisconnectResult, type Room, type RoomStore } from "./rooms";

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

function announceDisplacement(
  io: GameServer,
  socket: GameSocket,
  displaced: DisconnectResult,
): void {
  if (displaced.type === "room_closed") {
    socket.to(channel(displaced.pin)).emit("room:closed");
    void socket.leave(channel(displaced.pin));
    return;
  }

  if (displaced.type === "player_left") {
    const roomChannel = channel(displaced.room.pin);
    void socket.leave(roomChannel);
    io.to(roomChannel).emit("lobby:update", toLobby(displaced.room));
  }
}

export function attachGameServer(io: GameServer, store: RoomStore = rooms): void {
  io.on("connection", (socket) => {
    socket.on("host:create", () => {
      const { room, displaced } = store.createRoom(socket.id);
      announceDisplacement(io, socket, displaced);
      void socket.join(channel(room.pin));
      socket.emit("lobby:update", toLobby(room));
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
        const closedChannel = channel(result.closedPin);
        socket.to(closedChannel).emit("room:closed");
        io.in(closedChannel).socketsLeave(closedChannel);
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
      if (result.type === "room_closed") {
        io.to(channel(result.pin)).emit("room:closed");
        return;
      }

      if (result.type === "player_left") {
        io.to(channel(result.room.pin)).emit("lobby:update", toLobby(result.room));
      }
    });
  });
}
