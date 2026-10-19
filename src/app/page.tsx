"use client";

import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { useSocket } from "@/lib/socket";
import type { JoinErrorPayload, LobbyUpdate } from "@/shared/events";
import {
  JOIN_ERRORS,
  NICKNAME_MAX_LENGTH,
  PIN_LENGTH,
  capNicknameDraft,
  nicknameLength,
  normalizeNickname,
  normalizePin,
} from "@/shared/validation";

type Phase = "form" | "waiting" | "closed";

type FieldErrors = {
  pin?: string;
  nickname?: string;
  form?: string;
};

const PIN_FORMAT_ERROR = "Enter a 4-digit PIN.";

const fieldClassName =
  "mt-2 min-h-14 w-full rounded-lg border border-line bg-surface px-3 text-base text-foreground";

function errorsForMessage(message: string): FieldErrors {
  if (message === JOIN_ERRORS.unknownPin) {
    return { pin: message };
  }

  if (
    message === JOIN_ERRORS.emptyNickname ||
    message === JOIN_ERRORS.nicknameTooLong ||
    message === JOIN_ERRORS.duplicateNickname
  ) {
    return { nickname: message };
  }

  return { form: message };
}

export default function JoinPage() {
  const connection = useSocket();
  const socket = connection?.socket ?? null;
  const connected = connection?.connected ?? false;
  const [phase, setPhase] = useState<Phase>("form");
  const [pin, setPin] = useState("");
  const [nickname, setNickname] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [joining, setJoining] = useState(false);
  const [joinedName, setJoinedName] = useState("");
  const [hostReconnecting, setHostReconnecting] = useState(false);
  const joinedPinRef = useRef<string | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const [pinFocusKey, setPinFocusKey] = useState(0);

  const onLobbyUpdate = useEffectEvent((state: LobbyUpdate) => {
    if (phase === "closed" || (joinedPinRef.current !== null && state.pin !== joinedPinRef.current)) {
      return;
    }

    const normalized = normalizeNickname(nickname);
    const joined = state.players.some((player) => player.nickname === normalized);
    if (!joined) {
      return;
    }

    setJoinedName(normalized);
    setJoining(false);
    setErrors({});
    setPhase("waiting");
  });

  const onJoinError = useEffectEvent((error: JoinErrorPayload) => {
    setJoining(false);
    setHostReconnecting(false);
    setPhase("form");
    setErrors(errorsForMessage(error.message));
  });

  const onRoomClosed = useEffectEvent(() => {
    joinedPinRef.current = null;
    setHostReconnecting(false);
    setJoining(false);
    setPhase("closed");
  });

  const onHostReconnecting = useEffectEvent(() => {
    if (phase === "closed") {
      return;
    }
    setHostReconnecting(true);
  });

  const onHostReconnected = useEffectEvent(() => {
    setHostReconnecting(false);
  });

  const onDisconnect = useEffectEvent(() => {
    setJoining(false);
    setHostReconnecting(false);
    if (phase === "waiting") {
      joinedPinRef.current = null;
      setErrors({ form: "You were disconnected. Join again." });
      setPhase("form");
    }
  });

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleLobbyUpdate = (state: LobbyUpdate) => {
      onLobbyUpdate(state);
    };
    const handleJoinError = (error: JoinErrorPayload) => {
      onJoinError(error);
    };
    const handleRoomClosed = () => {
      onRoomClosed();
    };
    const handleDisconnect = () => {
      onDisconnect();
    };
    const handleHostReconnecting = () => {
      onHostReconnecting();
    };
    const handleHostReconnected = () => {
      onHostReconnected();
    };

    socket.on("lobby:update", handleLobbyUpdate);
    socket.on("join:error", handleJoinError);
    socket.on("room:closed", handleRoomClosed);
    socket.on("disconnect", handleDisconnect);
    socket.on("lobby:hostReconnecting", handleHostReconnecting);
    socket.on("lobby:hostReconnected", handleHostReconnected);

    const onVisible = () => {
      if (document.visibilityState === "visible" && !socket.connected) {
        socket.io.engine?.close();
        socket.disconnect();
        socket.connect();
      }
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      socket.off("lobby:update", handleLobbyUpdate);
      socket.off("join:error", handleJoinError);
      socket.off("room:closed", handleRoomClosed);
      socket.off("disconnect", handleDisconnect);
      socket.off("lobby:hostReconnecting", handleHostReconnecting);
      socket.off("lobby:hostReconnected", handleHostReconnected);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [socket]);

  const joinGame = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!socket || !connected || joining) {
        return;
      }

      const nextErrors: FieldErrors = {};
      const normalizedPin = normalizePin(pin);
      const normalizedNickname = normalizeNickname(nickname);

      if (!normalizedPin) {
        nextErrors.pin = PIN_FORMAT_ERROR;
      }

      if (normalizedNickname.length === 0) {
        nextErrors.nickname = JOIN_ERRORS.emptyNickname;
      } else if (nicknameLength(normalizedNickname) > NICKNAME_MAX_LENGTH) {
        nextErrors.nickname = JOIN_ERRORS.nicknameTooLong;
      }

      setErrors(nextErrors);
      if (!normalizedPin || nextErrors.nickname) {
        return;
      }

      joinedPinRef.current = normalizedPin;
      setJoining(true);
      socket.emit("player:join", { pin: normalizedPin, nickname });
    },
    [connected, joining, nickname, pin, socket],
  );

  const joinAnother = useCallback(() => {
    joinedPinRef.current = null;
    setHostReconnecting(false);
    setPin("");
    setPhase("form");
    setJoining(false);
    setErrors({});
    setPinFocusKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (pinFocusKey === 0) {
      return;
    }
    pinInputRef.current?.focus();
  }, [pinFocusKey]);

  const nicknameCount = nicknameLength(normalizeNickname(nickname));
  const nicknameOverLimit = nicknameCount > NICKNAME_MAX_LENGTH;
  const nicknameError = nicknameOverLimit ? JOIN_ERRORS.nicknameTooLong : errors.nickname;
  const nicknameDescribedBy = [
    "nickname-count",
    nicknameError ? "nickname-error" : null,
  ]
    .filter((id): id is string => id !== null)
    .join(" ");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
      <p className="text-xl font-semibold tracking-tight sm:text-3xl">Slophoot</p>

      {phase === "waiting" ? (
        <div className="mt-10">
          <h1 className="text-4xl font-semibold tracking-tight text-balance">{"You're in!"}</h1>
          <p role="status" className="mt-4 text-lg">
            Waiting for the host…
          </p>
          {hostReconnecting ? (
            <p role="status" className="mt-2 text-sm text-muted">
              Host is reconnecting…
            </p>
          ) : null}
          <p className="mt-6 text-sm text-muted">
            Joined as <span className="font-semibold text-foreground">{joinedName}</span>
          </p>
        </div>
      ) : null}

      {phase === "closed" ? (
        <div className="mt-10">
          <h1 className="text-4xl font-semibold tracking-tight text-balance">The room was closed</h1>
          <button
            type="button"
            onClick={joinAnother}
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-5 text-base font-semibold text-white hover:bg-accent-hover"
          >
            Join another game
          </button>
        </div>
      ) : null}

      {phase === "form" ? (
        <>
          <h1 className="mt-10 text-4xl font-semibold tracking-tight text-balance">Join a game</h1>
          <form onSubmit={joinGame} noValidate className="mt-8 flex flex-col gap-5">
            {errors.form ? (
              <p role="alert" className="text-sm font-medium text-red-800">
                {errors.form}
              </p>
            ) : null}

            <div>
              <label htmlFor="pin" className="text-sm font-semibold">
                PIN
              </label>
              <input
                ref={pinInputRef}
                id="pin"
                name="pin"
                value={pin}
                onChange={(event) => {
                  const nextPin = event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
                  setPin(nextPin);
                  setErrors((current) => (current.pin ? { ...current, pin: undefined } : current));
                }}
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                pattern="[0-9]*"
                maxLength={PIN_LENGTH}
                enterKeyHint="next"
                aria-invalid={errors.pin ? true : undefined}
                aria-describedby={errors.pin ? "pin-error" : undefined}
                className={`${fieldClassName} pl-[0.35em] text-center font-scoreboard text-4xl tracking-[0.35em]`}
              />
              {errors.pin ? (
                <p id="pin-error" role="alert" className="mt-2 text-sm font-medium text-red-800">
                  {errors.pin}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="nickname" className="text-sm font-semibold">
                Nickname
              </label>
              <input
                id="nickname"
                name="nickname"
                value={nickname}
                onChange={(event) => {
                  setNickname(capNicknameDraft(event.target.value));
                  setErrors((current) =>
                    current.nickname ? { ...current, nickname: undefined } : current,
                  );
                }}
                autoComplete="nickname"
                autoCapitalize="words"
                enterKeyHint="go"
                aria-invalid={nicknameError ? true : undefined}
                aria-describedby={nicknameDescribedBy}
                className={`${fieldClassName}${nicknameOverLimit ? " border-red-800" : ""}`}
              />
              <p
                id="nickname-count"
                className={`mt-2 text-sm tabular-nums ${nicknameOverLimit ? "font-medium text-red-800" : "text-muted"}`}
              >
                {nicknameCount} / {NICKNAME_MAX_LENGTH}
              </p>
              {nicknameError ? (
                <p
                  id="nickname-error"
                  role={errors.nickname ? "alert" : undefined}
                  className="mt-2 text-sm font-medium text-red-800"
                >
                  {nicknameError}
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={!connected || joining || nicknameOverLimit}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-5 text-base font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-700"
            >
              {joining ? "Joining…" : "Join"}
            </button>
            {!connected ? (
              <p role="status" className="text-sm text-muted">
                Connecting…
              </p>
            ) : null}
          </form>
          <Link
            href="/host"
            className="mt-8 text-sm font-medium text-foreground underline decoration-line underline-offset-4"
          >
            Host a game
          </Link>
        </>
      ) : null}
    </main>
  );
}
