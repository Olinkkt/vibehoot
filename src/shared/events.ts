export type LobbyPlayer = {
  nickname: string;
};

export type LobbyUpdate = {
  pin: string;
  players: LobbyPlayer[];
};

export type JoinErrorPayload = {
  message: string;
};

export type HostErrorPayload = {
  message: string;
};

export type PlayerJoinPayload = {
  pin: string;
  nickname: string;
};

export type HostReadyPayload = {
  pin: string;
  token: string;
};

export type HostResumePayload = {
  pin: string;
  token: string;
};

export interface ClientToServerEvents {
  "host:create": () => void;
  "host:resume": (payload: HostResumePayload) => void;
  "player:join": (payload: PlayerJoinPayload) => void;
}

export interface ServerToClientEvents {
  "lobby:update": (state: LobbyUpdate) => void;
  "join:error": (error: JoinErrorPayload) => void;
  "host:error": (error: HostErrorPayload) => void;
  "host:ready": (payload: HostReadyPayload) => void;
  "room:closed": () => void;
}
