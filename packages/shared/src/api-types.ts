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

/** A character on the public online list: no map or world, so it can't be used to find someone in PvP. */
export type OnlineCharacter = {
  id: number;
  name: string;
  level: number;
  className: string;
  channel: number;
};

export type GmLocation = GmLocationInput & { id: string };

export type TeleportResult = { sent: true; names: string[] };

export type GmMap = { id: number; name: string | null };

export type GmDestination = { name: string; mapId: number; x: number; y: number; z: number };

export type GmPlaces = { maps: GmMap[]; destinations: GmDestination[] };

/** A row in the game's table of logged-in users, which a stuck login never leaves. */
export type GmLogin = {
  key: number;
  account: string;
  /** Null until the player has entered the game. */
  character: string | null;
  world: number;
  channel: number;
  /** Someone tried to log in over this row. */
  blocked: boolean;
  loggedInAt: string;
};

export type GmLoginClearResult = { outcome: 'logged-out' | 'cleared' };

export type VendorShop = 'money' | 'pvp';

/** name and title are '' when the database holds '_'. */
export type GmVendor = {
  id: number; name: string; title: string; shop: VendorShop; country: string;
  mapId: number; mapName: string | null; itemCount: number; faceIcon: number | null;
};

export type GmVendorList = { database: string; vendors: GmVendor[] };

/**
 * name is null for a stock row whose item is not in TITEMCHART, and '' when the database holds '_'.
 * base, multiplier, price and soldBy are for the shop's currency: soldBy counts the vendors a price
 * edit changes.
 */
export type GmVendorItem = {
  itemId: number; name: string | null; level: number; icon: number | null; stack: number;
  base: number; multiplier: number; price: number; soldBy: number;
  inClient: boolean; canSellBack: boolean;
};

export type GmItemSearchResult = GmVendorItem & { name: string };

export type GmItemPriceResult = { itemId: number; name: string; price: number; multiplier: number; soldBy: number };
