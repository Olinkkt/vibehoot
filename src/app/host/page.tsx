"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { GoldButton, Logo, Stage } from "@/components/stage";
import { useSocket } from "@/lib/socket";
import type { HostErrorPayload, HostReadyPayload, LobbyPlayer, LobbyUpdate } from "@/shared/events";
import { HOST_ERRORS } from "@/shared/validation";

type LobbyState = {
  pin: string;
  players: LobbyPlayer[];
};

type HostSession = {
  pin: string;
  token: string;
};

const HOST_SESSION_KEY = "slophoot-host";
const RESUME_RETRY_LIMIT = 3;
const RESUME_RETRY_STEP_MS = 300;

function isTransientHostError(error: HostErrorPayload): boolean {
  return error.code === "transient" || error.code === undefined;
}

function readHostSession(): HostSession | null {
  try {
    const raw = window.sessionStorage.getItem(HOST_SESSION_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    if (!("pin" in parsed) || !("token" in parsed)) {
      return null;
    }

    const { pin, token } = parsed;
    if (typeof pin !== "string" || typeof token !== "string") {
      return null;
    }

    if (!/^\d{4}$/.test(pin) || !/^[a-f0-9]{32}$/.test(token)) {
      return null;
    }

    return { pin, token };
  } catch {
    return null;
  }
}

function writeHostSession(session: HostSession): void {
  try {
    window.sessionStorage.setItem(HOST_SESSION_KEY, JSON.stringify(session));
  } catch {
    // The open connection still works. A later refresh cannot reclaim the room.
  }
}

function clearHostSession(): void {
  try {
    window.sessionStorage.removeItem(HOST_SESSION_KEY);
  } catch {
    // Ignore storage failures. The server still decides when the room closes.
  }
}

export default function HostPage() {
  const connection = useSocket();
  const socket = connection?.socket ?? null;
  const connected = connection?.connected ?? false;
  const [creating, setCreating] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [replaced, setReplaced] = useState(false);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinCopied, setPinCopied] = useState(false);
  const lobbyRef = useRef<LobbyState | null>(null);
  const hostingRef = useRef(false);
  const reclaimingRef = useRef(false);
  const replacedRef = useRef(false);
  const resumeAttemptRef = useRef<string | null>(null);
  const resumeTriesRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lobbyRef.current = lobby;
  }, [lobby]);

  useEffect(() => {
    replacedRef.current = replaced;
  }, [replaced]);

  useEffect(() => {
    if (!lobby || replaced) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Current browsers show a generic prompt and ignore custom copy.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [lobby, replaced]);

  useEffect(() => {
    if (!socket || !lobby || replaced) {
      return;
    }

    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted || replacedRef.current || !lobbyRef.current || !socket.connected) {
        return;
      }

      socket.emit("host:leaving");
    };

    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [lobby, replaced, socket]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const clearRetryTimer = () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const onHostReady = (ready: HostReadyPayload) => {
      writeHostSession({ pin: ready.pin, token: ready.token });
      hostingRef.current = true;
    };

    const markReplaced = () => {
      clearRetryTimer();
      resumeTriesRef.current = 0;
      replacedRef.current = true;
      setReplaced(true);
      reclaimingRef.current = false;
      setReclaiming(false);
      hostingRef.current = false;
      setNotice(null);
      setLobby(null);
    };

    const onHostReplaced = () => {
      markReplaced();
    };

    const onDisconnect = (reason: string) => {
      clearRetryTimer();
      setCreating(false);

      if (replacedRef.current || reason === "io server disconnect") {
        markReplaced();
        return;
      }

      if (lobbyRef.current && readHostSession()) {
        reclaimingRef.current = true;
        setReclaiming(true);
        return;
      }

      hostingRef.current = false;
      reclaimingRef.current = false;
      setReclaiming(false);
      if (lobbyRef.current) {
        setNotice("The connection dropped and the room was closed.");
      }
      setLobby(null);
    };

    const onLobbyUpdate = (state: LobbyUpdate) => {
      if (!hostingRef.current) {
        return;
      }
      clearRetryTimer();
      resumeTriesRef.current = 0;
      setCreating(false);
      reclaimingRef.current = false;
      setReclaiming(false);
      setNotice(null);
      replacedRef.current = false;
      setReplaced(false);
      setLobby({ pin: state.pin, players: state.players });
    };

    const giveUpReclaim = (message: string) => {
      clearRetryTimer();
      resumeTriesRef.current = 0;
      setNotice(message);
      clearHostSession();
      hostingRef.current = false;
      reclaimingRef.current = false;
      setReclaiming(false);
      replacedRef.current = false;
      setReplaced(false);
      setLobby(null);
    };

    const onHostError = (error: HostErrorPayload) => {
      setCreating(false);
      if (reclaimingRef.current && isTransientHostError(error) && resumeTriesRef.current < RESUME_RETRY_LIMIT) {
        const session = readHostSession();
        if (session && socket.connected) {
          resumeTriesRef.current += 1;
          const delay = RESUME_RETRY_STEP_MS * resumeTriesRef.current;
          clearRetryTimer();
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (!socket.connected || !reclaimingRef.current) {
              return;
            }
            const latest = readHostSession();
            if (!latest) {
              return;
            }
            socket.emit("host:resume", latest);
          }, delay);
          return;
        }
      }

      if (reclaimingRef.current) {
        giveUpReclaim(HOST_ERRORS.roomGone);
        return;
      }

      setNotice(error.message);
      if (!lobbyRef.current) {
        clearHostSession();
        hostingRef.current = false;
        setLobby(null);
      }
    };

    socket.on("disconnect", onDisconnect);
    socket.on("host:ready", onHostReady);
    socket.on("lobby:update", onLobbyUpdate);
    socket.on("host:error", onHostError);
    socket.on("host:replaced", onHostReplaced);

    return () => {
      clearRetryTimer();
      socket.off("disconnect", onDisconnect);
      socket.off("host:ready", onHostReady);
      socket.off("lobby:update", onLobbyUpdate);
      socket.off("host:error", onHostError);
      socket.off("host:replaced", onHostReplaced);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket || !connected) {
      resumeAttemptRef.current = null;
      return;
    }

    if (replacedRef.current) {
      return;
    }

    const session = readHostSession();
    if (!session) {
      return;
    }

    const attemptKey = `${session.pin}:${session.token}`;
    if (resumeAttemptRef.current === attemptKey) {
      return;
    }

    if (lobbyRef.current && !reclaimingRef.current) {
      return;
    }

    resumeAttemptRef.current = attemptKey;
    resumeTriesRef.current = 0;
    hostingRef.current = true;
    reclaimingRef.current = true;
    setReclaiming(true);
    socket.emit("host:resume", session);
  }, [connected, socket]);

  const takeBack = useCallback(() => {
    const session = readHostSession();
    if (!session) {
      setNotice("No saved room session found.");
      setReplaced(false);
      replacedRef.current = false;
      return;
    }

    setReplaced(false);
    replacedRef.current = false;
    setNotice(null);
    hostingRef.current = true;
    reclaimingRef.current = true;
    setReclaiming(true);
    resumeTriesRef.current = 0;
    resumeAttemptRef.current = null;

    if (!socket) {
      return;
    }

    if (socket.connected) {
      resumeAttemptRef.current = `${session.pin}:${session.token}`;
      socket.emit("host:resume", session);
    } else {
      socket.connect();
    }
  }, [socket]);

  const copyPin = useCallback(() => {
    if (!lobby || !navigator.clipboard?.writeText) {
      return;
    }

    void navigator.clipboard.writeText(lobby.pin).then(
      () => {
        setPinCopied(true);
        if (copyTimerRef.current !== null) {
          clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = setTimeout(() => {
          copyTimerRef.current = null;
          setPinCopied(false);
        }, 2000);
      },
      () => {
        setPinCopied(false);
      },
    );
  }, [lobby]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const createRoom = useCallback(() => {
    if (!socket || !socket.connected) {
      return;
    }

    setNotice(null);
    setCreating(true);
    hostingRef.current = true;
    socket.emit("host:create");
  }, [socket]);

  if (replaced) {
    return (
      <Stage variant="join">
        <main className="relative z-1 mx-auto flex min-h-dvh w-full flex-col items-center justify-center px-4 py-8 text-center">
          <Logo className="sh-logo-join" priority />
          <h1 className="sh-fallback-title">Room open in another tab</h1>
          <p className="sh-in-sub">This room is now open in another tab.</p>
          <GoldButton type="button" className="sh-gold-join mt-8 max-w-[450px]" onClick={takeBack}>
            Take it back here
          </GoldButton>
          {notice ? (
            <p role="alert" className="sh-notice">
              {notice}
            </p>
          ) : null}
          <Link href="/" className="sh-quiet-link">
            Join a game
          </Link>
        </main>
      </Stage>
    );
  }

  if (lobby) {
    return (
      <Stage variant="lobby">
        <header className="sh-host-band">
          <button
            type="button"
            onClick={copyPin}
            className="sh-pin-plate"
            aria-label={`Game PIN ${lobby.pin}. Click to copy.`}
          >
            <span className="sh-pin-tag">Game PIN:</span>
            <span className="sh-pin-value">{lobby.pin}</span>
          </button>
          <span role="status" className="sr-only">
            {pinCopied ? "Copied" : ""}
          </span>
        </header>
        <Logo className="sh-logo-host" priority />
        <GoldButton
          type="button"
          className="sh-gold-start"
          disabled
          aria-label="Start game – coming soon"
          title="Start game – coming soon"
        >
          Start
        </GoldButton>
        {lobby.players.length === 0 ? (
          <p role="status" className="sh-wait-pill">
            {reclaiming ? "Reconnecting…" : "Waiting for players…"}
          </p>
        ) : (
          <ul aria-live="polite" aria-label="Players" className="sh-player-list">
            {lobby.players.map((player) => (
              <li key={player.nickname} className="sh-player-chip">
                {player.nickname}
              </li>
            ))}
          </ul>
        )}
      </Stage>
    );
  }

  if (reclaiming) {
    return (
      <Stage variant="lobby">
        <main className="relative z-1 mx-auto flex min-h-dvh w-full flex-col items-center justify-center px-4 py-8 text-center">
          <Logo className="sh-logo-join" />
          <h1 className="sh-fallback-title">Reconnecting</h1>
          <p role="status" className="sh-in-wait">
            Reconnecting to your room…
          </p>
        </main>
      </Stage>
    );
  }

  return (
    <Stage variant="join">
      <main className="relative z-1 mx-auto flex min-h-dvh w-full flex-col items-center justify-center px-4 py-8 text-center">
        <Logo className="sh-logo-join" priority />
        <h1 className="sr-only">Host a game</h1>
        <div className="sh-card">
          <p className="sh-card-label">Host a game</p>
          <p className="mb-1 text-center text-base font-bold text-sh-navy">
            Create a room, then share the PIN.
          </p>
          <GoldButton
            type="button"
            className="sh-gold-join"
            onClick={createRoom}
            disabled={!connected || creating}
          >
            {creating ? "Creating room…" : "Create room"}
          </GoldButton>
        </div>
        {!connected ? (
          <p role="status" className="sh-status">
            Connecting…
          </p>
        ) : null}
        {notice ? (
          <p role="alert" className="sh-notice">
            {notice}
          </p>
        ) : null}
        <Link href="/" className="sh-quiet-link">
          Join a game
        </Link>
      </main>
    </Stage>
  );
}
