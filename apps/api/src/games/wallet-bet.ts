// A bet moves money in TCHARTABLE directly, which is only safe while the game does not hold the character:
// TMapSvr keeps an online character's money in memory and writes it back when it saves.

import type { Wallet } from '@4story-portal/shared';

export const BET_OK = 0,
  BET_CLOSED = 1,
  BET_NOT_YOURS = 2,
  BET_ONLINE = 3,
  BET_POOR = 4;
export type BetCode = typeof BET_OK | typeof BET_CLOSED | typeof BET_NOT_YOURS | typeof BET_ONLINE | typeof BET_POOR;

/** A game's own refusal from its check step: 10 to 99, so it never meets a shared code. */
export type GameCode = number;
export const GAME_CODE_MIN = 10,
  GAME_CODE_MAX = 99;

export type BetOutcome = { code: typeof BET_OK; id: number; wallet: Wallet } | { code: Exclude<BetCode, typeof BET_OK>; name: string | null };

/** How a switch row is read, the same way the batch's SQL compares it: 'true' in any case, trailing spaces ignored. */
export const settingIsOn = (value: string | undefined): boolean => value?.trimEnd().toLowerCase() === 'true';

export type BetTables = { portalSettings: string; currentUsers: string; characters: string };

/**
 * One batch that takes @stake and adds @payout (both BIGINT Bronze) in an offline character's wallet.
 * Inputs the caller binds: @userId INT, @charId INT, @stake BIGINT, @payout BIGINT, plus whatever `record` uses.
 * `record` is the game's own INSERT; it may use @name (the character's name) and @wallet (Bronze afterwards).
 * `liveKey` is a constant from code, never user input.
 * `before` is the game's own SQL, run once every check has passed and before the wallet is written. It may set
 * @extra (BIGINT Bronze, 0 until then), which is paid into the wallet with @payout. `record` may use @extra.
 * `before` must return no result set (assign with SELECT @x = ...), since callers read the batch's first one.
 * `check` is the game's own refusal, run once every shared check has passed and before `before`, inside the
 * transaction and under the locks the shared part took. It may SET @code to a GameCode, 10 to 99, and then nothing
 * is written: the wallet, `before` and `record` all run only while @code is 0. It must return no result set either.
 * Any other code it sets is a bug there, and THROW rolls everything back.
 * Returns one row: { code, id, name, gold, silver, copper, extra }. `extra` is a BIGINT, so a string from the driver.
 * Throws on a negative or NULL @stake or @payout, and on a negative or NULL @extra; a zero stake is allowed.
 */
export function walletBetSql(tables: BetTables, liveKey: string, record: string, before = '', check = ''): string {
  // The online list is locked before the wallet. TLogin inserts the account's row and TEnterServer sets its
  // dwCharID, both by dwUserID, so the range lock makes them wait for the COMMIT: the character cannot enter
  // the game between the check and the UPDATE, and the map server loads the wallet only after it. The lock
  // also covers the gap up to the neighbouring accounts in the index, so at most they wait too.
  // A negative stake would pass the wallet check and add money, so it is refused before anything is read or
  // locked. This comes before XACT_ABORT, so the error does not also roll back a transaction the caller holds.
  // NULL is named on its own: NULL < 0 is unknown, so it would slip past the comparisons.
  return `SET NOCOUNT ON;
IF @stake IS NULL OR @payout IS NULL OR @stake < 0 OR @payout < 0 THROW 50000, 'Stake and payout cannot be negative', 1;
SET XACT_ABORT ON;
DECLARE @code INT = 0, @id INT = 0, @wallet BIGINT, @name VARCHAR(50), @online INT, @extra BIGINT = 0;
BEGIN TRAN;
IF NOT EXISTS (SELECT 1 FROM ${tables.portalSettings} WHERE szKey = '${liveKey}' AND szValue = 'true') SET @code = ${BET_CLOSED};
IF @code = 0
BEGIN
  -- A range lock on the account's rows in the online list: its login and enter-server wait for the COMMIT.
  -- FORCESEEK keeps it on the dwUserID index; a scan would range-lock every account's row. With no index
  -- to seek, the statement fails and the bet is refused with nothing written.
  SELECT @online = COUNT(CASE WHEN dwCharID = @charId THEN 1 END)
  FROM ${tables.currentUsers} WITH (UPDLOCK, HOLDLOCK, FORCESEEK) WHERE dwUserID = @userId;
  SELECT @name = szNAME, @wallet = CAST(dwGold AS BIGINT) * 1000000 + CAST(dwSilver AS BIGINT) * 1000 + dwCooper
  FROM ${tables.characters} WITH (UPDLOCK, ROWLOCK) WHERE dwCharID = @charId AND dwUserID = @userId AND bDelete = 0;
  IF @name IS NULL SET @code = ${BET_NOT_YOURS};
  ELSE IF @online > 0 SET @code = ${BET_ONLINE};
  ELSE IF @wallet < @stake SET @code = ${BET_POOR};
END${check ? gameCheck(check) : ''}
IF @code = 0
BEGIN
  ${before};
  -- A game's own step is code, so a negative or NULL extra is a bug there; THROW rolls everything back.
  IF @extra IS NULL OR @extra < 0 THROW 50000, 'Extra cannot be negative', 1;
  SET @wallet = @wallet - @stake + @payout + @extra;
  UPDATE ${tables.characters} SET dwGold = @wallet / 1000000, dwSilver = (@wallet / 1000) % 1000, dwCooper = @wallet % 1000 WHERE dwCharID = @charId;
  ${record};
  SET @id = SCOPE_IDENTITY();
END
COMMIT;
SELECT @code AS code, @id AS id, @name AS name,
       CAST(@wallet / 1000000 AS INT) AS gold, CAST((@wallet / 1000) % 1000 AS INT) AS silver, CAST(@wallet % 1000 AS INT) AS copper, @extra AS extra;`;
}

/** The game's check, run only while the shared checks have passed; a code it sets outside 10 to 99, or NULL, is a bug. */
const gameCheck = (check: string) => `
IF @code = 0
BEGIN
  ${check};
  IF @code IS NULL OR (@code <> 0 AND (@code < ${GAME_CODE_MIN} OR @code > ${GAME_CODE_MAX})) THROW 50000, 'A game code must be from ${GAME_CODE_MIN} to ${GAME_CODE_MAX}', 1;
END`;

/** The account's characters with wallet and whether each is in the game. Binds @userId. Columns: charId, name, level, classCode, gold, silver, copper, online (bit). Ordered by bSlot. */
export function walletCharactersSql(tables: BetTables): string {
  return `SELECT c.dwCharID AS charId, c.szNAME AS name, c.bLevel AS level, c.bClass AS classCode,
       c.dwGold AS gold, c.dwSilver AS silver, c.dwCooper AS copper,
       CAST(CASE WHEN EXISTS (SELECT 1 FROM ${tables.currentUsers} u WHERE u.dwCharID = c.dwCharID)
                 THEN 1 ELSE 0 END AS bit) AS online
FROM ${tables.characters} c
WHERE c.dwUserID = @userId AND c.bDelete = 0
ORDER BY c.bSlot`;
}
