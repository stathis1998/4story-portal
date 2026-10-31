import type { GmLocationInput } from './gm.js';

export type SessionUser = {
  userId: number;
  username: string;
};

export type Character = {
  id: number;
  slot: number;
  name: string;
  level: number;
  className: string;
  race: string;
  country: string;
  money: { gold: number; silver: number; copper: number };
  mapId: number;
  createdAt: string | null;
  lastLogoutAt: string | null;
};

export type ApiErrorBody = {
  statusCode: number;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type Me = SessionUser & { isGm: boolean };

export type ControlState = 'connecting' | 'connected' | 'disconnected' | 'login-failed';

export type GmStatus = {
  state: ControlState;
  worlds: { id: number; name: string }[];
  channels: number[];
};

export type OnlinePlayer = {
  charId: number;
  name: string;
  level: number;
  className: string;
  world: number;
  channel: number;
  mapId: number;
};

export type GmLocation = GmLocationInput & { id: string };

export type TeleportResult = { sent: true; names: string[] };
