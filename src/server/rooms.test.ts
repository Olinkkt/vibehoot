import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoomStore } from "./rooms";
import { JOIN_ERRORS } from "../shared/validation";

function pins(...values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

describe("room store", () => {
  it("creates a unique 4-digit PIN", () => {
    const store = createRoomStore({ randomPin: pins(7, 7, 8) });
    const first = store.createRoom("host-1");
    const second = store.createRoom("host-2");

    assert.equal(first.room.pin, "0007");
    assert.equal(second.room.pin, "0008");
    assert.deepEqual(first.displaced, { type: "none" });
    assert.equal(store.getRoom("0007")?.hostSocketId, "host-1");
  });

  it("throws when every PIN attempt is taken", () => {
    const store = createRoomStore({ randomPin: () => 1 });
    store.createRoom("host-1");
    assert.throws(() => store.createRoom("host-2"), /No free room PIN/);
  });

  it("replaces the previous room when the same host creates again", () => {
    const store = createRoomStore({ randomPin: pins(11, 22) });
    store.createRoom("host-1");
    store.join("0011", "Ada", "player-1");
    const next = store.createRoom("host-1");

    assert.equal(next.room.pin, "0022");
    assert.deepEqual(next.displaced, { type: "room_closed", pin: "0011" });
    assert.equal(store.getRoom("0011"), null);
    assert.equal(store.join("0011", "Ada", "player-2").ok, false);
  });

  it("rejects an unknown PIN, an empty nickname, a long nickname, and a duplicate", () => {
    const store = createRoomStore({ randomPin: () => 42 });
    store.createRoom("host");

    assert.deepEqual(store.join("9999", "Ada", "p1"), {
      ok: false,
      message: JOIN_ERRORS.unknownPin,
    });
    assert.deepEqual(store.join("0042", "   ", "p1"), {
      ok: false,
      message: JOIN_ERRORS.emptyNickname,
    });
    assert.deepEqual(store.join("0042", "a".repeat(21), "p1"), {
      ok: false,
      message: JOIN_ERRORS.nicknameTooLong,
    });

    const joined = store.join("0042", "Ada", "p1");
    assert.equal(joined.ok, true);
    assert.deepEqual(store.join("0042", "ada", "p2"), {
      ok: false,
      message: JOIN_ERRORS.duplicateNickname,
    });
    assert.equal(store.getRoom("0042")?.players.length, 1);
  });

  it("accepts a 20-character nickname and trims surrounding spaces", () => {
    const store = createRoomStore({ randomPin: () => 15 });
    store.createRoom("host");
    const nickname = "a".repeat(20);
    const joined = store.join("0015", `  ${nickname}  `, "p1");

    assert.equal(joined.ok, true);
    if (joined.ok) {
      assert.equal(joined.room.players[0]?.nickname, nickname);
    }
  });

  it("counts nickname length in characters, not UTF-16 code units", () => {
    const store = createRoomStore({ randomPin: () => 16 });
    store.createRoom("host");
    const nickname = "😀".repeat(20);
    const joined = store.join("0016", nickname, "p1");

    assert.equal(joined.ok, true);
    assert.equal(store.join("0016", "😀".repeat(21), "p2").ok, false);
  });

  it("removes a player on disconnect and deletes the room when the host disconnects", () => {
    const store = createRoomStore({ randomPin: () => 77 });
    store.createRoom("host");
    store.join("0077", "Ada", "p1");
    store.join("0077", "Kenji", "p2");

    const left = store.disconnect("p1");
    assert.equal(left.type, "player_left");
    if (left.type === "player_left") {
      assert.deepEqual(
        left.room.players.map((player) => player.nickname),
        ["Kenji"],
      );
    }

    assert.deepEqual(store.disconnect("host"), { type: "room_closed", pin: "0077" });
    assert.equal(store.getRoom("0077"), null);
    assert.deepEqual(store.disconnect("p2"), { type: "none" });
  });

  it("closes the hosted room when that host joins another room as a player", () => {
    const store = createRoomStore({ randomPin: pins(1111, 2222) });
    store.createRoom("host-a");
    store.join("1111", "Quinn", "player-q");
    store.createRoom("host-b");

    const rejected = store.join("2222", "   ", "host-a");
    assert.equal(rejected.ok, false);
    assert.equal(store.getRoom("1111")?.hostSocketId, "host-a");

    const joined = store.join("2222", "H2AsPlayer", "host-a");
    assert.equal(joined.ok, true);
    if (joined.ok) {
      assert.equal(joined.closedPin, "1111");
      assert.deepEqual(
        joined.room.players.map((player) => player.nickname),
        ["H2AsPlayer"],
      );
    }

    assert.equal(store.getRoom("1111"), null);
    assert.equal(store.join("1111", "Late", "player-late").ok, false);
    assert.deepEqual(store.disconnect("player-q"), { type: "none" });
    assert.deepEqual(store.disconnect("host-a"), {
      type: "player_left",
      room: store.getRoom("2222"),
    });
  });

  it("rejects a host joining their own room and keeps them as host", () => {
    const store = createRoomStore({ randomPin: () => 3333 });
    store.createRoom("host-a");
    store.join("3333", "Quinn", "player-q");

    assert.deepEqual(store.join("3333", "Host", "host-a"), {
      ok: false,
      message: JOIN_ERRORS.invalidRequest,
    });
    assert.equal(store.getRoom("3333")?.hostSocketId, "host-a");
    assert.deepEqual(store.disconnect("host-a"), { type: "room_closed", pin: "3333" });
  });
});
