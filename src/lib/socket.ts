"use client";

import { useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/shared/events";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type SocketConnection = {
  socket: AppSocket;
  connected: boolean;
};

let sharedSocket: AppSocket | undefined;
let snapshot: SocketConnection | undefined;

function getSharedSocket(): AppSocket {
  if (!sharedSocket) {
    sharedSocket = io({ autoConnect: false });
  }
  return sharedSocket;
}

function readSnapshot(): SocketConnection {
  const socket = getSharedSocket();
  if (snapshot?.socket === socket && snapshot.connected === socket.connected) {
    return snapshot;
  }

  snapshot = { socket, connected: socket.connected };
  return snapshot;
}

function subscribe(onStoreChange: () => void): () => void {
  const socket = getSharedSocket();
  if (!socket.connected) {
    socket.connect();
  }

  socket.on("connect", onStoreChange);
  socket.on("disconnect", onStoreChange);

  return () => {
    socket.off("connect", onStoreChange);
    socket.off("disconnect", onStoreChange);
  };
}

function getServerSnapshot(): SocketConnection | null {
  return null;
}

export function useSocket(): SocketConnection | null {
  return useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);
}
