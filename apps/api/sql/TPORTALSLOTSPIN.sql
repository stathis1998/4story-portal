-- Every spin of the portal's slot machines, written by the bet batch in the same transaction that takes the
-- stake and pays the win from the character's wallet, so money never moves without its row.
--   Money is in Bronze (1 Silver = 1000 Bronze).
--   llAdded and llJackpot are the jackpots' part of a spin: what a lost round put in the pots, what a win took out.
--   llAddMini, llAddMajor, llAddGiga and llWonMini, llWonMajor, llWonGiga are each pot's share of those two; llAdded
--   and llJackpot stay their sums, so a reader from before the three pots still adds up the same money.
--   A round is one row: the paid spin's five stops, its free spins in szFree, the meter's free spins in szMeterFree
--   (both slotFreeText, up to 50 spins), the meter's points before the round in bMeterBefore (a replay needs them to
--   know whether the meter fired), and the whole round's payout.
--   bRules 1 is a three-reel row, 2 a five-reel row without cascades, 3 a cascade round. 1 and 2 stay in the totals
--   and out of every list.
--   The character's name is copied here, so a rename or delete later does not change history.
--   IX_TPORTALSLOTSPIN_USER_TIME serves the daily limit's count of an account's rounds since midnight.
IF OBJECT_ID('dbo.TPORTALSLOTSPIN', 'U') IS NULL
BEGIN
	CREATE TABLE dbo.TPORTALSLOTSPIN (
		dwID			INT IDENTITY(1,1)	NOT NULL CONSTRAINT PK_TPORTALSLOTSPIN PRIMARY KEY,
		dwUserID		INT				NOT NULL,	-- the account
		dwCharID		INT				NOT NULL,	-- whose wallet paid and was paid
		szCharName		VARCHAR(50)		NOT NULL,
		dSpun			DATETIME		NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_dSpun DEFAULT GETDATE(),
		szMachine		VARCHAR(20)		NOT NULL,	-- 'shelf', 'armoury', 'hoard'
		bStop1			TINYINT			NOT NULL,	-- 0 to 31, where each reel stopped
		bStop2			TINYINT			NOT NULL,
		bStop3			TINYINT			NOT NULL,
		bStop4			TINYINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bStop4 DEFAULT 0,
		bStop5			TINYINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bStop5 DEFAULT 0,
		llStake			BIGINT			NOT NULL,	-- Bronze
		llPayout		BIGINT			NOT NULL,	-- Bronze, the stake included
		llWallet		BIGINT			NOT NULL,	-- Bronze, the wallet afterwards
		wMultiple		SMALLINT		NOT NULL,	-- the prize as a multiple of the stake, 0 for none
		llAdded			BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llAdded DEFAULT 0,		-- Bronze this spin added to the jackpots
		llJackpot		BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llJackpot DEFAULT 0,	-- Bronze it was paid from the jackpots
		bRules			TINYINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bRules DEFAULT 1,	-- 1: three reels, 2: five reels, 3: cascades
		szFree			VARCHAR(800)	NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_szFree DEFAULT '',	-- the free spins' stops, slotFreeText
		szMeterFree		VARCHAR(800)	NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_szMeterFree DEFAULT '',	-- the meter's free spins' stops
		llAddMini		BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llAddMini DEFAULT 0,
		llAddMajor		BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llAddMajor DEFAULT 0,
		llAddGiga		BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llAddGiga DEFAULT 0,
		llWonMini		BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llWonMini DEFAULT 0,
		llWonMajor		BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llWonMajor DEFAULT 0,
		llWonGiga		BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llWonGiga DEFAULT 0,
		bMeterBefore	TINYINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bMeterBefore DEFAULT 0	-- the meter's points before the round
	);
	CREATE INDEX IX_TPORTALSLOTSPIN_USER ON dbo.TPORTALSLOTSPIN (dwUserID, dwID);
END

-- A table made before the jackpot gets its two columns here.
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'llAdded') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD llAdded BIGINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llAdded DEFAULT 0;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'llJackpot') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD llJackpot BIGINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llJackpot DEFAULT 0;

-- A table made before the five-reel machines gets its four columns here. An old row keeps rules 1.
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'bStop4') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD bStop4 TINYINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bStop4 DEFAULT 0;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'bStop5') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD bStop5 TINYINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bStop5 DEFAULT 0;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'bRules') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD bRules TINYINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bRules DEFAULT 1;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'szFree') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD szFree VARCHAR(800) NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_szFree DEFAULT '';

-- A table made before the cascades: the free text widened to hold 50 spins, the meter's free spins, each pot's
-- share, the meter before the round, and the index for the daily count. An older row keeps its rules number and reads 0 for each pot.
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'szFree') < 800
	ALTER TABLE dbo.TPORTALSLOTSPIN ALTER COLUMN szFree VARCHAR(800) NOT NULL;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'szMeterFree') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD szMeterFree VARCHAR(800) NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_szMeterFree DEFAULT '';
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'llAddMini') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD llAddMini BIGINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llAddMini DEFAULT 0;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'llAddMajor') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD llAddMajor BIGINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llAddMajor DEFAULT 0;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'llAddGiga') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD llAddGiga BIGINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llAddGiga DEFAULT 0;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'llWonMini') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD llWonMini BIGINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llWonMini DEFAULT 0;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'llWonMajor') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD llWonMajor BIGINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llWonMajor DEFAULT 0;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'llWonGiga') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD llWonGiga BIGINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llWonGiga DEFAULT 0;
IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'bMeterBefore') IS NULL
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD bMeterBefore TINYINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bMeterBefore DEFAULT 0;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.TPORTALSLOTSPIN') AND name = 'IX_TPORTALSLOTSPIN_USER_TIME')
	CREATE INDEX IX_TPORTALSLOTSPIN_USER_TIME ON dbo.TPORTALSLOTSPIN (dwUserID, dSpun);
