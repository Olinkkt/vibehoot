"use client";

import { Play, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "@/lib/socket";
import type { HostErrorPayload, LobbyPlayer, LobbyUpdate } from "@/shared/events";

type LobbyState = {
  pin: string;
  players: LobbyPlayer[];
};

function PinDigits({ pin }: { pin: string }) {
  const digits = pin.split("");

  return (
    <p
      className="mt-3 flex justify-center gap-[0.06em] font-scoreboard text-[clamp(5.5rem,16vw,11rem)] leading-none font-semibold text-foreground"
      aria-label={`Game PIN ${digits.join(" ")}`}
    >
      {digits.map((digit, index) => (
        <span
          key={`${pin}-${index.toString()}`}
          aria-hidden="true"
          className="inline-block min-w-[0.72em] text-center"
        >
          {digit}
        </span>
      ))}
    </p>
  );
}

export default function HostPage() {
  const connection = useSocket();
  const socket = connection?.socket ?? null;
  const connected = connection?.connected ?? false;
  const [creating, setCreating] = useState(false);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lobbyRef = useRef<LobbyState | null>(null);
  const hostingRef = useRef(false);

  useEffect(() => {
    lobbyRef.current = lobby;
  }, [lobby]);

  useEffect(() => {
    if (!lobby) {
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
  }, [lobby]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const onDisconnect = () => {
      hostingRef.current = false;
      setCreating(false);
      if (lobbyRef.current) {
        setNotice("The connection dropped and the room was closed.");
      }
      setLobby(null);
    };

    const onLobbyUpdate = (state: LobbyUpdate) => {
      if (!hostingRef.current) {
        return;
      }
      setCreating(false);
      setNotice(null);
      setLobby({ pin: state.pin, players: state.players });
    };

    const onHostError = (error: HostErrorPayload) => {
      setCreating(false);
      setNotice(error.message);
      if (!lobbyRef.current) {
        hostingRef.current = false;
      }
    };

    socket.on("disconnect", onDisconnect);
    socket.on("lobby:update", onLobbyUpdate);
    socket.on("host:error", onHostError);

    return () => {
      socket.off("disconnect", onDisconnect);
      socket.off("lobby:update", onLobbyUpdate);
      socket.off("host:error", onHostError);
    };
  }, [socket]);

  const createRoom = useCallback(() => {
    if (!socket || !socket.connected) {
      return;
    }

    setNotice(null);
    setCreating(true);
    hostingRef.current = true;
    socket.emit("host:create");
  }, [socket]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <p className="text-sm font-semibold tracking-tight">Slophoot</p>
        <p className="text-sm font-medium text-muted">Host</p>
      </header>

      {lobby ? (
        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            <p className="text-sm font-semibold tracking-[0.22em] text-muted uppercase">
              Game PIN
            </p>
            <PinDigits pin={lobby.pin} />
            <p className="mt-4 max-w-md text-lg text-pretty text-foreground">
              Players enter this PIN to join.
            </p>
          </div>

          <section aria-labelledby="players-heading" className="w-full">
            <h2 id="players-heading" className="flex items-center gap-2 text-xl font-semibold">
              <Users aria-hidden="true" className="size-5" strokeWidth={2.25} />
              Players
              <span className="tabular-nums text-muted">({lobby.players.length})</span>
            </h2>
            {lobby.players.length === 0 ? (
              <p className="mt-3 border-y border-line py-6 text-lg text-muted">
                Waiting for players to join.
              </p>
            ) : (
              <ul aria-live="polite" className="mt-3 divide-y divide-line border-y border-line">
                {lobby.players.map((player) => (
                  <li key={player.nickname} className="py-3 text-2xl font-medium sm:text-3xl">
                    {player.nickname}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              disabled
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-zinc-200 px-6 text-base font-semibold text-zinc-700 sm:w-auto"
            >
              <Play aria-hidden="true" className="size-5" strokeWidth={2.25} />
              Start game – coming soon
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Host a game
          </h1>
          <p className="mt-4 max-w-md text-lg text-pretty text-foreground">
            Create a room, then share the PIN. Players join from their phones.
          </p>
          <button
            type="button"
            onClick={createRoom}
            disabled={!connected || creating}
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-6 text-base font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-700 sm:w-auto"
          >
            {creating ? "Creating room…" : "Create room"}
          </button>
          {!connected ? (
            <p role="status" className="mt-4 text-sm text-muted">
              Connecting…
            </p>
          ) : null}
          {notice ? (
            <p role="alert" className="mt-4 max-w-md text-sm font-medium text-red-800">
              {notice}
            </p>
          ) : null}
          <Link
            href="/"
            className="mt-8 text-sm font-medium text-foreground underline decoration-line underline-offset-4"
          >
            Join a game
          </Link>
        </div>
      )}
    </main>
  );
}
