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
