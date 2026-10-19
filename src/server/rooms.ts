import { randomInt } from "node:crypto";
import {
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
  | { type: "room_closed"; pin: string };

type Membership =
  | { role: "host"; pin: string }
  | { role: "player"; pin: string };

const PIN_ATTEMPTS = 50;

export type RoomStore = {
  createRoom: (hostSocketId: string) => { room: Room; displaced: DisconnectResult };
  join: (pin: string, nickname: string, socketId: string) => JoinResult;
  disconnect: (socketId: string) => DisconnectResult;
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

export function createRoomStore(options: RoomStoreOptions = {}): RoomStore {
  const rooms = new Map<string, Room>();
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
    const current = membership.get(socketId);
    if (!current) {
      return { type: "none" };
    }

    if (current.role === "host") {
      deleteRoom(current.pin);
      return { type: "room_closed", pin: current.pin };
    }

    const room = removePlayer(current.pin, socketId);
    if (!room) {
      return { type: "none" };
    }

    return { type: "player_left", room };
  }

  function createRoom(hostSocketId: string): { room: Room; displaced: DisconnectResult } {
    const displaced = disconnect(hostSocketId);
    let pin: string | null = null;

    for (let attempt = 0; attempt < PIN_ATTEMPTS; attempt += 1) {
      const candidate = String(randomPin()).padStart(PIN_LENGTH, "0");
      if (candidate.length === PIN_LENGTH && !rooms.has(candidate)) {
        pin = candidate;
        break;
      }
    }

    if (!pin) {
      throw new Error("No free room PIN is available.");
    }

    const room: Room = { pin, hostSocketId, players: [] };
    rooms.set(pin, room);
    membership.set(hostSocketId, { role: "host", pin });
    return { room: snapshot(room), displaced };
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

  return { createRoom, join, disconnect, getRoom };
}
