import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoomStore } from "./rooms";
import {
  HOST_ERRORS,
  JOIN_ERRORS,
  NICKNAME_DRAFT_CAP,
  NICKNAME_MAX_LENGTH,
  capNicknameDraft,
  nicknameLength,
  normalizeNickname,
} from "../shared/validation";

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

  it("scans for a free PIN when random draws collide", () => {
    const store = createRoomStore({ randomPin: () => 1 });
    const first = store.createRoom("host-1");
    const second = store.createRoom("host-2");

    assert.equal(first.room.pin, "0001");
    assert.equal(second.room.pin, "0000");
  });

  it("throws when no PIN remains and keeps the caller's current room", () => {
    let next = 0;
    const store = createRoomStore({ randomPin: () => next++ });
    store.createRoom("host-keep");

    for (let index = 1; index < 10_000; index += 1) {
      store.createRoom(`host-${index.toString()}`);
    }

    assert.throws(() => store.createRoom("host-keep"), /No free room PIN/);
    assert.equal(store.getRoom("0000")?.hostSocketId, "host-keep");
    assert.equal(store.getRoom("9999")?.hostSocketId, "host-9999");
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

  it("counts nickname drafts in code points and keeps input past 20 characters", () => {
    const twentyEmoji = "😀".repeat(NICKNAME_MAX_LENGTH);
    const twentyOneEmoji = "😀".repeat(NICKNAME_MAX_LENGTH + 1);
    assert.equal(capNicknameDraft(twentyEmoji), twentyEmoji);
    assert.equal(capNicknameDraft(twentyOneEmoji), twentyOneEmoji);
    assert.equal(nicknameLength(normalizeNickname(capNicknameDraft(twentyOneEmoji))), 21);
    assert.equal(capNicknameDraft("a".repeat(25)), "a".repeat(25));

    const capped = capNicknameDraft("😀".repeat(NICKNAME_DRAFT_CAP + 5));
    assert.equal(nicknameLength(capped), NICKNAME_DRAFT_CAP);
    assert.equal(capped.length, NICKNAME_DRAFT_CAP * 2);
  });

  it("strips format characters before the duplicate and empty checks", () => {
    assert.equal(normalizeNickname("Ada\u200B"), "Ada");
    assert.equal(normalizeNickname("\u200B"), "");
    assert.equal(normalizeNickname("\u202Eevil"), "evil");
    assert.equal(normalizeNickname("Ada\u200B  Lovelace"), "Ada Lovelace");
    assert.equal(normalizeNickname("Ａｄａ"), "Ada");

    const store = createRoomStore({ randomPin: () => 42 });
    store.createRoom("host");
    store.join("0042", "Ada", "p1");

    assert.deepEqual(store.join("0042", "Ada\u200B", "p2"), {
      ok: false,
      message: JOIN_ERRORS.duplicateNickname,
    });
    assert.deepEqual(store.join("0042", "\u200B", "p3"), {
      ok: false,
      message: JOIN_ERRORS.emptyNickname,
    });
    assert.deepEqual(store.join("0042", "\u202EAda", "p4"), {
      ok: false,
      message: JOIN_ERRORS.duplicateNickname,
    });
    assert.deepEqual(store.join("0042", "Ａｄａ", "p5"), {
      ok: false,
      message: JOIN_ERRORS.duplicateNickname,
    });

    const joined = store.join("0042", "\u202Eevil", "p6");
    assert.equal(joined.ok, true);
    if (joined.ok) {
      assert.equal(joined.room.players.at(-1)?.nickname, "evil");
    }
    assert.equal(store.getRoom("0042")?.players.length, 2);
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

  it("keeps the PIN and players while the host is away and restores them on resume", () => {
    const store = createRoomStore({ randomPin: () => 4242 });
    const created = store.createRoom("host");
    store.join("4242", "Ada", "p1");

    assert.deepEqual(store.suspendHost("host"), {
      type: "host_away",
      pin: "4242",
      reservationSocketId: "host",
    });
    assert.equal(store.getRoom("4242")?.hostSocketId, "");
    assert.equal(store.getRoom("4242")?.players[0]?.nickname, "Ada");
    assert.equal(store.resumeHost("4242", "0".repeat(32), "host-2").ok, false);
    assert.equal(store.getRoom("4242")?.hostSocketId, "");

    const resumed = store.resumeHost("4242", created.token, "host-2");
    assert.equal(resumed.ok, true);
    if (resumed.ok) {
      assert.equal(resumed.replacedSocketId, null);
      assert.equal(resumed.room.pin, "4242");
      assert.equal(resumed.room.hostSocketId, "host-2");
      assert.deepEqual(
        resumed.room.players.map((player) => player.nickname),
        ["Ada"],
      );
      assert.equal(resumed.token, created.token);
    }

    assert.equal(store.expireHost("4242").type, "none");
    assert.equal(store.disconnect("host").type, "none");
    assert.equal(store.getRoom("4242")?.hostSocketId, "host-2");
  });

  it("replaces a still-connected host when the token matches", () => {
    const store = createRoomStore({ randomPin: () => 6363 });
    const created = store.createRoom("host");
    store.join("6363", "Ada", "p1");

    const wrong = store.resumeHost("6363", "0".repeat(32), "host-2");
    assert.deepEqual(wrong, { ok: false, message: HOST_ERRORS.roomGone, code: "invalid" });
    assert.equal(store.getRoom("6363")?.hostSocketId, "host");

    const resumed = store.resumeHost("6363", created.token, "host-2");
    assert.equal(resumed.ok, true);
    if (resumed.ok) {
      assert.equal(resumed.replacedSocketId, "host");
      assert.equal(resumed.room.hostSocketId, "host-2");
      assert.deepEqual(
        resumed.room.players.map((player) => player.nickname),
        ["Ada"],
      );
    }

    assert.equal(store.suspendHost("host").type, "none");
    assert.equal(store.disconnect("host").type, "none");
    assert.equal(store.isHostAway("6363"), false);
    assert.equal(store.getRoom("6363")?.hostSocketId, "host-2");

    const again = store.resumeHost("6363", created.token, "host-2");
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.replacedSocketId, null);
    }
    assert.equal(store.getRoom("6363")?.hostSocketId, "host-2");
  });

  it("deletes the room when the host grace period expires", () => {
    const store = createRoomStore({ randomPin: () => 5150 });
    store.createRoom("host");
    store.join("5150", "Ada", "p1");
    store.suspendHost("host");

    assert.deepEqual(store.expireHost("5150"), { type: "room_closed", pin: "5150" });
    assert.equal(store.getRoom("5150"), null);
    assert.equal(store.disconnect("p1").type, "none");
    assert.equal(store.resumeHost("5150", "ab".repeat(16), "host-2").ok, false);
  });
});
