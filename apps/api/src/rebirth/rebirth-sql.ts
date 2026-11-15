// A rebirth rewrites the character in TCHARTABLE and its skill (and twin skill), hotkey and quest rows directly, which is only
// safe while the game does not hold the character: TMapSvr keeps an online character in memory and writes it
// back when it saves. So the batch takes the same lock on the online list as a bet does (games/wallet-bet.ts).

import { REBIRTH_LEVEL } from '@4story-portal/shared';
import type { tableNames } from '../db/db.service.js';

export const REBIRTH_OK = 0,
  REBIRTH_CLOSED = 1,
  REBIRTH_NOT_YOURS = 2,
  REBIRTH_ONLINE = 3,
  REBIRTH_LOW_LEVEL = 4,
  REBIRTH_WEARING = 5,
  REBIRTH_AT_LIMIT = 6,
  REBIRTH_PRICE_CHANGED = 7,
  REBIRTH_POOR = 8;
export type RebirthCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const START_SKILL_POINTS = 200; // TCreateChar with a level option, which is how every character here is made

/** The setting rows in TPORTALSETTING. Constants from code, so the batch may name them inline. */
export const REBIRTH_KEYS = { live: 'rebirth_live', priceGold: 'rebirth_price_gold', percent: 'rebirth_percent', limit: 'rebirth_limit' } as const;

/** TCreateChar's start points by country; any other country starts at the third. */
const SPAWN_BY_COUNTRY = [15001, 15002] as const;
const SPAWN_OTHER = 15003;
/** The equipment bag: an item there is worn. */
const WORN = 'bOwnerType = 0 AND bStorageType = 0 AND dwStorageID = 254';
const HOTKEY_SLOTS = Array.from({ length: 12 }, (_, i) => i + 1);

type Tables = ReturnType<typeof tableNames>;

/**
 * The IDs of the items `owner` (a SQL expression) wears, from TITEMTABLE and its twin TTEMPITEMTABLE, each ID
 * once. The twin counts too: TLogout leaves the online list a few statements before it copies the twin over
 * TITEMTABLE, so for a moment the twin is the only place an item still worn shows. The page and the batch
 * both use this, so "Nothing worn" agrees with the button.
 */
export const wornItemIds = (tables: Tables, owner: string): string =>
  `SELECT dlID FROM ${tables.characterItems} WHERE dwOwnerID = ${owner} AND ${WORN}
   UNION SELECT dlID FROM ${tables.tempItems} WHERE dwOwnerID = ${owner} AND ${WORN}`;

/**
 * One batch that checks a rebirth and, when every check passes, resets the character to level 1 and takes the
 * price, together, in one transaction. A refusal writes nothing; the first check that fails decides the code.
 * Binds @userId INT, @charId INT, @expectedPriceGold INT, @baseline VARCHAR(2000), @text VARCHAR(160).
 * `@text` may name {name} and {rebirth}, which are filled in for the log row.
 * Returns one row: { code, id, name, rebirth, bonus, priceGold, gold, silver, copper }.
 * Throws, rolling back everything (the caller's transaction too), when the start point is missing.
 */
export function rebirthSql(tables: Tables): string {
  // A skill hotkey is cleared once its skill is no longer learned: no row, or a row at level 0. Item slots
  // (type 2) and empty ones are left alone.
  const clearHotkeys = HOTKEY_SLOTS.map(
    (n) => `UPDATE h SET bType${n} = 0, wID${n} = 0 FROM ${tables.hotkeys} h
  WHERE h.dwCharID = @charId AND h.bType${n} = 1
    AND NOT EXISTS (SELECT 1 FROM ${tables.skills} s WHERE s.dwCharID = @charId AND s.wSkillID = h.wID${n} AND s.bLevel > 0);`,
  ).join('\n  ');

  // The online list is locked before the character, as in walletBetSql: TLogin inserts the account's row and
  // TEnterServer sets its dwCharID, both by dwUserID, so the range lock makes them wait for the COMMIT and the
  // character cannot enter the game between the checks and the writes.
  return `SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @code INT = 0, @id INT = 0, @live INT, @price INT, @percent INT, @limit INT, @online INT,
        @name VARCHAR(50), @level INT, @class INT, @race INT, @country INT, @wallet BIGINT,
        @count INT = 0, @priceGold INT, @rebirth INT, @bonus INT, @exp INT = 0, @hp INT = 2, @mp INT = 2,
        @spawnId SMALLINT, @mapId SMALLINT, @x REAL, @y REAL, @z REAL;
BEGIN TRAN;
-- Missing or unreadable rows are NULL, and a NULL fails the CASE, so they mean closed. The switch is
-- compared in the column's collation, as walletBetSql does: 'true' in any case, trailing spaces ignored.
SELECT @live = MAX(CASE WHEN szKey = '${REBIRTH_KEYS.live}' AND szValue = 'true' THEN 1 ELSE 0 END),
       @price = MAX(CASE WHEN szKey = '${REBIRTH_KEYS.priceGold}' THEN TRY_CAST(szValue AS INT) END),
       @percent = MAX(CASE WHEN szKey = '${REBIRTH_KEYS.percent}' THEN TRY_CAST(szValue AS INT) END),
       @limit = MAX(CASE WHEN szKey = '${REBIRTH_KEYS.limit}' THEN TRY_CAST(szValue AS INT) END)
FROM ${tables.portalSettings}
WHERE szKey IN ('${REBIRTH_KEYS.live}', '${REBIRTH_KEYS.priceGold}', '${REBIRTH_KEYS.percent}', '${REBIRTH_KEYS.limit}');
SET @code = CASE WHEN @live = 1 AND @price BETWEEN 1 AND 100000 AND @percent BETWEEN 1 AND 10 AND @limit BETWEEN 1 AND 20
                      AND @percent * @limit <= 100 THEN 0 ELSE ${REBIRTH_CLOSED} END;
IF @code = 0
BEGIN
  -- A range lock on the account's rows in the online list: its login and enter-server wait for the COMMIT.
  -- FORCESEEK keeps it on the dwUserID index; a scan would range-lock every account's row. With no index
  -- to seek, the statement fails and the rebirth is refused with nothing written.
  SELECT @online = COUNT(CASE WHEN dwCharID = @charId THEN 1 END)
  FROM ${tables.currentUsers} WITH (UPDLOCK, HOLDLOCK, FORCESEEK) WHERE dwUserID = @userId;
  SELECT @name = szNAME, @level = bLevel, @class = bClass, @race = bRace, @country = bCountry,
         @wallet = CAST(dwGold AS BIGINT) * 1000000 + CAST(dwSilver AS BIGINT) * 1000 + dwCooper
  FROM ${tables.characters} WITH (UPDLOCK, ROWLOCK) WHERE dwCharID = @charId AND dwUserID = @userId AND bDelete = 0;
  IF @name IS NULL SET @code = ${REBIRTH_NOT_YOURS};
  ELSE IF @online > 0 SET @code = ${REBIRTH_ONLINE};
  ELSE IF @level < ${REBIRTH_LEVEL} SET @code = ${REBIRTH_LOW_LEVEL};
  ELSE IF EXISTS (${wornItemIds(tables, '@charId')}) SET @code = ${REBIRTH_WEARING};
END
IF @code = 0
BEGIN
  -- HOLDLOCK covers the missing row too, so two presses cannot both insert the first rebirth.
  SELECT @count = bRebirth FROM ${tables.rebirths} WITH (UPDLOCK, HOLDLOCK) WHERE dwCharID = @charId;
  SET @priceGold = (@count + 1) * @price;
  IF @count >= @limit SET @code = ${REBIRTH_AT_LIMIT};
  -- A NULL expected price is never the price, so ISNULL keeps it from slipping past the comparison.
  ELSE IF @priceGold <> ISNULL(@expectedPriceGold, -1) SET @code = ${REBIRTH_PRICE_CHANGED};
  ELSE IF @wallet < CAST(@priceGold AS BIGINT) * 1000000 SET @code = ${REBIRTH_POOR};
END
IF @code = 0
BEGIN
  SET @rebirth = @count + 1;
  SET @bonus = (CASE WHEN @rebirth < @limit THEN @rebirth ELSE @limit END) * @percent;
  SET @wallet = @wallet - CAST(@priceGold AS BIGINT) * 1000000;

  -- What TCreateChar gives a new character: the EXP of the level below (none below level 1), HP and MP from
  -- the class and race charts, and the start point of the country.
  SELECT @exp = dwEXP FROM ${tables.levels} WHERE bLevel = 0;
  SELECT @hp = @hp + wCON, @mp = @mp + wMEN FROM ${tables.classChart} WHERE bClassID = @class;
  SELECT @hp = @hp + wCON, @mp = @mp + wMEN FROM ${tables.raceChart} WHERE bRaceID = @race;
  SET @spawnId = CASE @country ${SPAWN_BY_COUNTRY.map((id, country) => `WHEN ${country} THEN ${id}`).join(' ')} ELSE ${SPAWN_OTHER} END;
  SELECT @mapId = wMapID, @x = fPosX, @y = fPosY, @z = fPosZ FROM ${tables.spawnPositions} WHERE wID = @spawnId;
  IF @mapId IS NULL THROW 50000, 'Start point missing', 1;

  UPDATE ${tables.characters}
  SET bLevel = 1, dwEXP = @exp, wSkillPoint = ${START_SKILL_POINTS}, dwHP = 7 * @hp + 1, dwMP = 9 * @mp + 1,
      wSpawnID = @spawnId, wMapID = @mapId, fPosX = @x, fPosY = @y, fPosZ = @z,
      wLastSpawnID = 0, dwLastDestination = 0, dwRegion = 0, bAftermath = 0,
      dwGold = @wallet / 1000000, dwSilver = (@wallet / 1000) % 1000, dwCooper = @wallet % 1000
  WHERE dwCharID = @charId;

  -- Learned skills (any chart kind but 0) go back to a new character's: start skills to their start level,
  -- the rest removed. Equip skills (kind 0) and rows with no chart entry stay as they are. No gold back.
  UPDATE s SET bLevel = st.bLevel
  FROM ${tables.skills} s
  JOIN ${tables.skillChart} c ON c.wID = s.wSkillID
  JOIN ${tables.startSkills} st ON st.bClassID = @class AND st.wSkillID = s.wSkillID
  WHERE s.dwCharID = @charId AND c.bKind <> 0;
  DELETE s
  FROM ${tables.skills} s
  JOIN ${tables.skillChart} c ON c.wID = s.wSkillID
  WHERE s.dwCharID = @charId AND c.bKind <> 0
    AND NOT EXISTS (SELECT 1 FROM ${tables.startSkills} st WHERE st.bClassID = @class AND st.wSkillID = s.wSkillID);
  INSERT INTO ${tables.skills} (dwCharID, wSkillID, bLevel, dwRemainTick)
  SELECT @charId, st.wSkillID, st.bLevel, 0 FROM ${tables.startSkills} st
  WHERE st.bClassID = @class
    AND NOT EXISTS (SELECT 1 FROM ${tables.skills} s WHERE s.dwCharID = @charId AND s.wSkillID = st.wSkillID);

  -- The twin that saves write: TLogout copies it over TSKILLTABLE at every logout, even one with no save
  -- before it, so it must hold the new skills too or the old life's come back.
  DELETE FROM ${tables.tempSkills} WHERE dwCharID = @charId;
  INSERT INTO ${tables.tempSkills} (dwCharID, wSkillID, bLevel, dwRemainTick)
  SELECT dwCharID, wSkillID, bLevel, dwRemainTick FROM ${tables.skills} WHERE dwCharID = @charId;

  ${clearHotkeys}

  DELETE FROM ${tables.skillMaintains} WHERE dwCharID = @charId;
  DELETE FROM ${tables.tempSkillMaintains} WHERE dwCharID = @charId;
  DELETE FROM ${tables.quests} WHERE dwCharID = @charId;
  DELETE FROM ${tables.questTerms} WHERE dwCharID = @charId;
  DELETE FROM ${tables.levelFreezes} WHERE dwCharID = @charId;

  -- The global copy of the level; TLogout would also set it at the next logout.
  UPDATE ${tables.allCharacters} SET bLevel = 1, dwEXP = @exp WHERE dwCharID = @charId AND dwUserID = @userId;

  UPDATE ${tables.rebirths} SET bRebirth = @rebirth, bStatBonus = @bonus, dUpdate = GETDATE() WHERE dwCharID = @charId;
  IF @@ROWCOUNT = 0
    INSERT INTO ${tables.rebirths} (dwCharID, bRebirth, bStatBonus, dUpdate) VALUES (@charId, @rebirth, @bonus, GETDATE());

  -- {rebirth} is filled in first, so a name holding that word is not changed. LEFT keeps a long name from
  -- failing the rebirth over its announcement.
  INSERT INTO ${tables.rebirthLog} (dwUserID, dwCharID, szCharName, bRebirth, bStatBonus, dwPriceGold, szBaseline, szText)
  VALUES (@userId, @charId, @name, @rebirth, @bonus, @priceGold, @baseline,
          LEFT(REPLACE(REPLACE(@text, '{rebirth}', CAST(@rebirth AS VARCHAR(3))), '{name}', @name), 160));
  SET @id = SCOPE_IDENTITY();
END
COMMIT;
SELECT @code AS code, @id AS id, @name AS name, @rebirth AS rebirth, @bonus AS bonus, @priceGold AS priceGold,
       CAST(@wallet / 1000000 AS INT) AS gold, CAST((@wallet / 1000) % 1000 AS INT) AS silver, CAST(@wallet % 1000 AS INT) AS copper;`;
}
