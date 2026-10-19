import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  HostResumePayload,
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

export const HOST_RECONNECT_GRACE_MS = 12_000;

export type AttachOptions = {
  graceMs?: number;
};

function channel(pin: string): string {
  return `room:${pin}`;
}

function toLobby(room: Room): LobbyUpdate {
  return {
    pin: room.pin,
    players: room.players.map((player) => ({ nickname: player.nickname })),
  };
}

function isResumePayload(payload: unknown): payload is HostResumePayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return typeof record.pin === "string" && typeof record.token === "string";
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
  options: AttachOptions = {},
): void {
  const graceMs = options.graceMs ?? HOST_RECONNECT_GRACE_MS;
  const graceTimers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; reservationSocketId: string }
  >();
  let stopped = false;

  function clearGrace(pin: string): string | null {
    const pending = graceTimers.get(pin);
    if (!pending) {
      return null;
    }

    clearTimeout(pending.timer);
    graceTimers.delete(pin);
    return pending.reservationSocketId;
  }

  function graceHolds(socketId: string): boolean {
    for (const pending of graceTimers.values()) {
      if (pending.reservationSocketId === socketId) {
        return true;
      }
    }

    return false;
  }

  function armGrace(pin: string, reservationSocketId: string): void {
    clearGrace(pin);
    const timer = setTimeout(() => {
      graceTimers.delete(pin);
      if (stopped) {
        return;
      }

      const expired = store.expireHost(pin);
      if (expired.type !== "room_closed") {
        return;
      }

      limiter.release(reservationSocketId);
      closeChannel(io, pin);
    }, graceMs);
    timer.unref();
    graceTimers.set(pin, { timer, reservationSocketId });
  }

  function beginHostGrace(pin: string, reservationSocketId: string): void {
    limiter.clearCooldown(reservationSocketId);
    armGrace(pin, reservationSocketId);
    io.to(channel(pin)).emit("lobby:hostReconnecting");
  }

  io.engine.on("close", () => {
    stopped = true;
    for (const pending of graceTimers.values()) {
      clearTimeout(pending.timer);
    }
    graceTimers.clear();
  });

  io.on("connection", (socket) => {
    socket.on("host:create", () => {
      const decision = limiter.tryAcquire(socket.id, clientAddress(socket));
      if (!decision.ok) {
        socket.emit("host:error", { message: decision.message });
        return;
      }

      try {
        const { room, token, displaced } = store.createRoom(socket.id);
        if (displaced.type === "room_closed") {
          const reservationSocketId = clearGrace(displaced.pin);
          if (reservationSocketId) {
            limiter.release(reservationSocketId);
          }
        }
        announceDisplacement(io, socket, displaced);
        void socket.join(channel(room.pin));
        socket.emit("host:ready", { pin: room.pin, token });
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

    socket.on("host:resume", (payload: HostResumePayload) => {
      if (!isResumePayload(payload)) {
        socket.emit("host:error", { message: HOST_ERRORS.roomGone, code: "invalid" });
        return;
      }

      const result = store.resumeHost(payload.pin, payload.token, socket.id);
      if (!result.ok) {
        socket.emit("host:error", { message: result.message, code: result.code });
        return;
      }

      const roomChannel = channel(result.room.pin);
      if (result.replacedSocketId) {
        limiter.reassign(result.replacedSocketId, socket.id);
        const previous = io.sockets.sockets.get(result.replacedSocketId);
        if (previous && previous.id !== socket.id) {
          previous.emit("host:replaced");
          previous.disconnect(true);
        }
      }

      const reservationSocketId = clearGrace(result.room.pin);
      if (reservationSocketId && reservationSocketId !== socket.id) {
        limiter.reassign(reservationSocketId, socket.id);
      }

      if (reservationSocketId) {
        io.to(roomChannel).emit("lobby:hostReconnected");
      }

      void socket.join(roomChannel);
      socket.emit("host:ready", { pin: result.room.pin, token: result.token });
      socket.emit("lobby:update", toLobby(result.room));
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
        const reservationSocketId = clearGrace(result.closedPin);
        limiter.release(reservationSocketId ?? socket.id);
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
      if (store.isHostAway(result.room.pin)) {
        socket.emit("lobby:hostReconnecting");
      }
    });

    socket.on("host:leaving", () => {
      const result = store.leaveHost(socket.id);
      if (result.type !== "host_away") {
        return;
      }

      void socket.leave(channel(result.pin));
      beginHostGrace(result.pin, result.reservationSocketId);
    });

    socket.on("disconnect", () => {
      const result = store.suspendHost(socket.id);
      if (result.type === "host_away") {
        beginHostGrace(result.pin, result.reservationSocketId);
        return;
      }

      if (!graceHolds(socket.id)) {
        limiter.forget(socket.id);
      }
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
