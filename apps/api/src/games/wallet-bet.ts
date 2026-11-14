// A bet moves money in TCHARTABLE directly, which is only safe while the game does not hold the character:
// TMapSvr keeps an online character's money in memory and writes it back when it saves.

export const BET_OK = 0,
  BET_CLOSED = 1,
  BET_NOT_YOURS = 2,
  BET_ONLINE = 3,
  BET_POOR = 4;
export type BetCode = typeof BET_OK | typeof BET_CLOSED | typeof BET_NOT_YOURS | typeof BET_ONLINE | typeof BET_POOR;

export type BetTables = { portalSettings: string; currentUsers: string; characters: string };

/**
 * One batch that takes @stake and adds @payout (both BIGINT Bronze) in an offline character's wallet.
 * Inputs the caller binds: @userId INT, @charId INT, @stake BIGINT, @payout BIGINT, plus whatever `record` uses.
 * `record` is the game's own INSERT; it may use @name (the character's name) and @wallet (Bronze afterwards).
 * `liveKey` is a constant from code, never user input.
 * Returns one row: { code, id, name, gold, silver, copper }.
 */
export function walletBetSql(tables: BetTables, liveKey: string, record: string): string {
  // The online list is locked before the wallet. TLogin inserts the account's row and TEnterServer sets its
  // dwCharID, both by dwUserID, so the range lock makes them wait for the COMMIT: the character cannot enter
  // the game between the check and the UPDATE, and the map server loads the wallet only after it.
  return `SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @code INT = 0, @id INT = 0, @wallet BIGINT, @name VARCHAR(50), @online INT;
BEGIN TRAN;
IF NOT EXISTS (SELECT 1 FROM ${tables.portalSettings} WHERE szKey = '${liveKey}' AND szValue = 'true') SET @code = ${BET_CLOSED};
IF @code = 0
BEGIN
  -- A range lock on the account's rows in the online list: its login and enter-server wait for the COMMIT.
  SELECT @online = COUNT(CASE WHEN dwCharID = @charId THEN 1 END)
  FROM ${tables.currentUsers} WITH (UPDLOCK, HOLDLOCK) WHERE dwUserID = @userId;
  SELECT @name = szNAME, @wallet = CAST(dwGold AS BIGINT) * 1000000 + CAST(dwSilver AS BIGINT) * 1000 + dwCooper
  FROM ${tables.characters} WITH (UPDLOCK, ROWLOCK) WHERE dwCharID = @charId AND dwUserID = @userId AND bDelete = 0;
  IF @name IS NULL SET @code = ${BET_NOT_YOURS};
  ELSE IF @online > 0 SET @code = ${BET_ONLINE};
  ELSE IF @wallet < @stake SET @code = ${BET_POOR};
END
IF @code = 0
BEGIN
  SET @wallet = @wallet - @stake + @payout;
  UPDATE ${tables.characters} SET dwGold = @wallet / 1000000, dwSilver = (@wallet / 1000) % 1000, dwCooper = @wallet % 1000 WHERE dwCharID = @charId;
  ${record};
  SET @id = SCOPE_IDENTITY();
END
COMMIT;
SELECT @code AS code, @id AS id, @name AS name,
       CAST(@wallet / 1000000 AS INT) AS gold, CAST((@wallet / 1000) % 1000 AS INT) AS silver, CAST(@wallet % 1000 AS INT) AS copper;`;
}

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
