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

export interface ClientToServerEvents {
  "host:create": () => void;
  "player:join": (payload: PlayerJoinPayload) => void;
}

export interface ServerToClientEvents {
  "lobby:update": (state: LobbyUpdate) => void;
  "join:error": (error: JoinErrorPayload) => void;
  "host:error": (error: HostErrorPayload) => void;
  "room:closed": () => void;
}
