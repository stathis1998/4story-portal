-- Every spin of the portal's slot machines, written by the bet batch in the same transaction that takes the
-- stake and pays the win from the character's wallet, so money never moves without its row.
--   Money is in Bronze (1 Silver = 1000 Bronze).
--   llAdded and llJackpot are the jackpot's part of a spin: what a lost round put in the pot, what a win took out.
--   A round is one row: the paid spin's five stops, then its free spins in szFree, and the whole round's payout.
--   bRules 1 is a three-reel row from before the five-reel machines; it stays in the totals and out of every list.
--   The character's name is copied here, so a rename or delete later does not change history.
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
		llAdded			BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llAdded DEFAULT 0,		-- Bronze this spin added to the jackpot
		llJackpot		BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llJackpot DEFAULT 0,	-- Bronze it was paid from the jackpot
		bRules			TINYINT			NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bRules DEFAULT 1,	-- 1: three reels (old), 2: five reels
		szFree			VARCHAR(400)	NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_szFree DEFAULT ''	-- the free spins' stops, slotFreeText
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
	ALTER TABLE dbo.TPORTALSLOTSPIN ADD szFree VARCHAR(400) NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_szFree DEFAULT '';
