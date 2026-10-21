"use client";

import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { GoldButton, Logo, Stage } from "@/components/stage";
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
type FormStep = "pin" | "nickname";

type FieldErrors = {
  pin?: string;
  nickname?: string;
  form?: string;
};

const PIN_FORMAT_ERROR = "Enter a 4-digit PIN.";

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
  const [formStep, setFormStep] = useState<FormStep>("pin");
  const [pin, setPin] = useState("");
  const [nickname, setNickname] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [joining, setJoining] = useState(false);
  const [joinedName, setJoinedName] = useState("");
  const [joinedPin, setJoinedPin] = useState("");
  const [hostReconnecting, setHostReconnecting] = useState(false);
  const joinedPinRef = useRef<string | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const nicknameInputRef = useRef<HTMLInputElement>(null);
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
    setJoinedPin(state.pin);
    setJoining(false);
    setErrors({});
    setPhase("waiting");
  });

  const onJoinError = useEffectEvent((error: JoinErrorPayload) => {
    setJoining(false);
    setHostReconnecting(false);
    setPhase("form");
    const nextErrors = errorsForMessage(error.message);
    setErrors(nextErrors);
    setFormStep(nextErrors.pin ? "pin" : "nickname");
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
      setFormStep("pin");
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

  const submitPin = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedPin = normalizePin(pin);
    if (!normalizedPin) {
      setErrors({ pin: PIN_FORMAT_ERROR });
      return;
    }

    setErrors({});
    setFormStep("nickname");
  }, [pin]);

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
      if (!normalizedPin) {
        setFormStep("pin");
        return;
      }
      if (nextErrors.nickname) {
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
    setFormStep("pin");
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

  useEffect(() => {
    if (phase === "form" && formStep === "nickname") {
      nicknameInputRef.current?.focus();
    }
  }, [formStep, phase]);

  const nicknameCount = nicknameLength(normalizeNickname(nickname));
  const nicknameOverLimit = nicknameCount > NICKNAME_MAX_LENGTH;
  const nicknameError = nicknameOverLimit ? JOIN_ERRORS.nicknameTooLong : errors.nickname;
  const nicknameDescribedBy = ["nickname-count", nicknameError ? "nickname-error" : null]
    .filter((id): id is string => id !== null)
    .join(" ");

  if (phase === "waiting") {
    return (
      <Stage variant="lobby">
        <div className="relative z-1 flex min-h-dvh flex-col">
          <header className="sh-topbar">
            <p className="sh-player-pin">
              PIN: <b>{joinedPin || pin}</b>
            </p>
            <Logo className="sh-logo-player" />
          </header>
          <main className="sh-player-main">
            <h1 className="sh-in-title">You’re in!</h1>
            <p className="sh-in-sub">See your nickname on screen?</p>
            <p role="status" className="sh-in-wait">
              {hostReconnecting ? "Host is reconnecting…" : "Waiting for the host to start…"}
            </p>
          </main>
          <footer className="sh-bottombar">
            <p className="sh-player-nick">{joinedName}</p>
            <div className="sh-score" aria-label="Score 0">
              0
            </div>
          </footer>
        </div>
      </Stage>
    );
  }

  return (
    <Stage variant="join">
      <main className="relative z-1 mx-auto flex min-h-dvh w-full flex-col items-center justify-center px-4 py-8">
        <Logo className="sh-logo-join" priority />

        {phase === "closed" ? (
          <div className="sh-card">
            <h1 className="sh-card-label">The room was closed</h1>
            <GoldButton type="button" className="sh-gold-join" onClick={joinAnother}>
              Join another game
            </GoldButton>
          </div>
        ) : null}

        {phase === "form" && formStep === "pin" ? (
          <form onSubmit={submitPin} noValidate className="sh-card">
            {errors.form ? (
              <p role="alert" className="sh-error sh-error-lead">
                {errors.form}
              </p>
            ) : null}
            <label htmlFor="pin" className="sh-card-label">
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
              placeholder="Enter PIN"
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              pattern="[0-9]*"
              maxLength={PIN_LENGTH}
              enterKeyHint="next"
              aria-invalid={errors.pin ? true : undefined}
              aria-describedby={errors.pin ? "pin-error" : undefined}
              className="sh-field"
            />
            {errors.pin ? (
              <p id="pin-error" role="alert" className="sh-error">
                {errors.pin}
              </p>
            ) : null}
            <GoldButton type="submit" className="sh-gold-join" disabled={!connected}>
              Join
            </GoldButton>
          </form>
        ) : null}

        {phase === "form" && formStep === "nickname" ? (
          <form onSubmit={joinGame} noValidate className="sh-card sh-card-nick">
            {errors.form ? (
              <p role="alert" className="sh-error sh-error-lead">
                {errors.form}
              </p>
            ) : null}
            <label htmlFor="nickname" className="sr-only">
              Nickname
            </label>
            <input
              ref={nicknameInputRef}
              id="nickname"
              name="nickname"
              value={nickname}
              onChange={(event) => {
                setNickname(capNicknameDraft(event.target.value));
                setErrors((current) =>
                  current.nickname ? { ...current, nickname: undefined } : current,
                );
              }}
              placeholder="Nickname"
              autoComplete="nickname"
              autoCapitalize="words"
              enterKeyHint="go"
              aria-invalid={nicknameError ? true : undefined}
              aria-describedby={nicknameDescribedBy}
              className="sh-field"
            />
            <p id="nickname-count" className="sr-only">
              {nicknameCount} / {NICKNAME_MAX_LENGTH}
            </p>
            {nicknameError ? (
              <p
                id="nickname-error"
                role={errors.nickname ? "alert" : undefined}
                className="sh-error"
              >
                {nicknameError}
              </p>
            ) : null}
            <GoldButton
              type="submit"
              className="sh-gold-join"
              disabled={!connected || joining || nicknameOverLimit}
            >
              {joining ? "Joining…" : "Ok, go"}
            </GoldButton>
          </form>
        ) : null}

        {!connected && phase === "form" ? (
          <p role="status" className="sh-status">
            Connecting…
          </p>
        ) : null}

        {phase === "form" ? (
          <Link href="/host" className="sh-quiet-link">
            Host a game
          </Link>
        ) : null}
      </main>
    </Stage>
  );
}
