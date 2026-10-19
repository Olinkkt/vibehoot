import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { HostErrorCode } from "../shared/events";
import {
  HOST_ERRORS,
  JOIN_ERRORS,
  NICKNAME_MAX_LENGTH,
  PIN_LENGTH,
  nicknameLength,
  normalizeNickname,
  normalizePin,
} from "../shared/validation";

export type Player = {
  socketId: string;
  nickname: string;
};

export type Room = {
  pin: string;
  hostSocketId: string;
  players: Player[];
};

export type JoinSuccess = {
  ok: true;
  room: Room;
  previousRoom: Room | null;
  /** Set when this socket was hosting another room that had to be closed. */
  closedPin: string | null;
};

export type JoinFailure = {
  ok: false;
  message: string;
};

export type JoinResult = JoinSuccess | JoinFailure;

export type DisconnectResult =
  | { type: "none" }
  | { type: "player_left"; room: Room }
  | { type: "room_closed"; pin: string }
  | { type: "host_away"; pin: string; reservationSocketId: string };

export type ResumeResult =
  | { ok: true; room: Room; token: string; replacedSocketId: string | null }
  | { ok: false; message: string; code: HostErrorCode };

type Membership =
  | { role: "host"; pin: string }
  | { role: "player"; pin: string };

type StoredRoom = Room & {
  hostToken: string;
  hostAway: boolean;
};

const PIN_ATTEMPTS = 50;
const PIN_SPACE = 10_000;

export const NO_FREE_PIN_MESSAGE = "No free room PIN is available.";

export type RoomStore = {
  createRoom: (hostSocketId: string) => { room: Room; token: string; displaced: DisconnectResult };
  join: (pin: string, nickname: string, socketId: string) => JoinResult;
  disconnect: (socketId: string) => DisconnectResult;
  suspendHost: (socketId: string) => DisconnectResult;
  leaveHost: (socketId: string) => DisconnectResult;
  resumeHost: (pin: string, token: string, socketId: string) => ResumeResult;
  expireHost: (pin: string) => DisconnectResult;
  isHostAway: (pin: string) => boolean;
  getRoom: (pin: string) => Room | null;
};

export type RoomStoreOptions = {
  randomPin?: () => number;
};

function snapshot(room: Room): Room {
  return {
    pin: room.pin,
    hostSocketId: room.hostSocketId,
    players: room.players.map((player) => ({
      socketId: player.socketId,
      nickname: player.nickname,
    })),
  };
}

function sameNickname(left: string, right: string): boolean {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

function tokensMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length === 0 || leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

export function createRoomStore(options: RoomStoreOptions = {}): RoomStore {
  const rooms = new Map<string, StoredRoom>();
  const membership = new Map<string, Membership>();
  const randomPin = options.randomPin ?? (() => randomInt(0, 10_000));

  function removePlayer(pin: string, socketId: string): Room | null {
    const room = rooms.get(pin);
    if (!room) {
      membership.delete(socketId);
      return null;
    }

    room.players = room.players.filter((player) => player.socketId !== socketId);
    membership.delete(socketId);
    return snapshot(room);
  }

  function deleteRoom(pin: string): void {
    const room = rooms.get(pin);
    if (!room) {
      return;
    }

    membership.delete(room.hostSocketId);
    for (const player of room.players) {
      membership.delete(player.socketId);
    }
    rooms.delete(pin);
  }

  function disconnect(socketId: string): DisconnectResult {
    return removeMember(socketId, true);
  }

  function suspendHost(socketId: string): DisconnectResult {
    return removeMember(socketId, false);
  }

  function leaveHost(socketId: string): DisconnectResult {
    const current = membership.get(socketId);
    if (current?.role !== "host") {
      return { type: "none" };
    }

    return removeMember(socketId, false);
  }

  function removeMember(socketId: string, immediate: boolean): DisconnectResult {
    const current = membership.get(socketId);
    if (!current) {
      return { type: "none" };
    }

    if (current.role === "player") {
      const room = removePlayer(current.pin, socketId);
      if (!room) {
        return { type: "none" };
      }
      return { type: "player_left", room };
    }

    const hosted = rooms.get(current.pin);
    if (!hosted || hosted.hostSocketId !== socketId) {
      membership.delete(socketId);
      return { type: "none" };
    }

    if (!immediate) {
      hosted.hostAway = true;
      hosted.hostSocketId = "";
      membership.delete(socketId);
      return { type: "host_away", pin: hosted.pin, reservationSocketId: socketId };
    }

    deleteRoom(current.pin);
    return { type: "room_closed", pin: current.pin };
  }

  function resumeHost(pinInput: string, token: string, socketId: string): ResumeResult {
    const pin = normalizePin(pinInput);
    const room = pin ? rooms.get(pin) : undefined;
    if (!pin || !room) {
      return { ok: false, message: HOST_ERRORS.roomGone, code: "expired" };
    }

    if (!tokensMatch(room.hostToken, token)) {
      return { ok: false, message: HOST_ERRORS.roomGone, code: "invalid" };
    }

    const current = membership.get(socketId);
    if (current?.role === "host" && current.pin === room.pin) {
      return { ok: true, room: snapshot(room), token: room.hostToken, replacedSocketId: null };
    }

    if (current) {
      return { ok: false, message: HOST_ERRORS.roomGone, code: "invalid" };
    }

    let replacedSocketId: string | null = null;
    if (!room.hostAway && room.hostSocketId.length > 0 && room.hostSocketId !== socketId) {
      replacedSocketId = room.hostSocketId;
      membership.delete(replacedSocketId);
    }

    room.hostAway = false;
    room.hostSocketId = socketId;
    membership.set(socketId, { role: "host", pin: room.pin });
    return { ok: true, room: snapshot(room), token: room.hostToken, replacedSocketId };
  }

  function isHostAway(pin: string): boolean {
    return rooms.get(pin)?.hostAway ?? false;
  }

  function expireHost(pin: string): DisconnectResult {
    const room = rooms.get(pin);
    if (!room || !room.hostAway) {
      return { type: "none" };
    }

    deleteRoom(pin);
    return { type: "room_closed", pin };
  }

  function allocatePin(): string | null {
    for (let attempt = 0; attempt < PIN_ATTEMPTS; attempt += 1) {
      const candidate = String(randomPin()).padStart(PIN_LENGTH, "0");
      if (candidate.length === PIN_LENGTH && !rooms.has(candidate)) {
        return candidate;
      }
    }

    for (let value = 0; value < PIN_SPACE; value += 1) {
      const candidate = String(value).padStart(PIN_LENGTH, "0");
      if (!rooms.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function createRoom(hostSocketId: string): {
    room: Room;
    token: string;
    displaced: DisconnectResult;
  } {
    const pin = allocatePin();
    if (!pin) {
      throw new Error(NO_FREE_PIN_MESSAGE);
    }

    const displaced = disconnect(hostSocketId);
    const hostToken = randomBytes(16).toString("hex");
    const room: StoredRoom = { pin, hostSocketId, players: [], hostToken, hostAway: false };
    rooms.set(pin, room);
    membership.set(hostSocketId, { role: "host", pin });
    return { room: snapshot(room), token: hostToken, displaced };
  }

  function join(pinInput: string, nicknameInput: string, socketId: string): JoinResult {
    const pin = normalizePin(pinInput);
    const room = pin ? rooms.get(pin) : undefined;
    if (!pin || !room) {
      return { ok: false, message: JOIN_ERRORS.unknownPin };
    }

    if (room.hostSocketId === socketId) {
      return { ok: false, message: JOIN_ERRORS.invalidRequest };
    }

    const nickname = normalizeNickname(nicknameInput);
    if (nickname.length === 0) {
      return { ok: false, message: JOIN_ERRORS.emptyNickname };
    }

    if (nicknameLength(nickname) > NICKNAME_MAX_LENGTH) {
      return { ok: false, message: JOIN_ERRORS.nicknameTooLong };
    }

    const current = membership.get(socketId);
    const rejoiningSameRoom = current?.role === "player" && current.pin === room.pin;
    const taken = room.players.some((player) => {
      if (rejoiningSameRoom && player.socketId === socketId) {
        return false;
      }
      return sameNickname(player.nickname, nickname);
    });

    if (taken) {
      return { ok: false, message: JOIN_ERRORS.duplicateNickname };
    }

    let previousRoom: Room | null = null;
    let closedPin: string | null = null;
    if (current?.role === "host" && current.pin !== room.pin) {
      closedPin = current.pin;
      deleteRoom(current.pin);
    } else if (current?.role === "player" && current.pin !== room.pin) {
      previousRoom = removePlayer(current.pin, socketId);
    }

    if (rejoiningSameRoom) {
      const player = room.players.find((entry) => entry.socketId === socketId);
      if (player) {
        player.nickname = nickname;
      }
    } else {
      room.players.push({ socketId, nickname });
      membership.set(socketId, { role: "player", pin: room.pin });
    }

    return { ok: true, room: snapshot(room), previousRoom, closedPin };
  }

  function getRoom(pin: string): Room | null {
    const room = rooms.get(pin);
    return room ? snapshot(room) : null;
  }

  return {
    createRoom,
    join,
    disconnect,
    suspendHost,
    leaveHost,
    resumeHost,
    expireHost,
    isHostAway,
    getRoom,
  };
}
