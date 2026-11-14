-- Every spin of the portal's slot machines, written by the bet batch in the same transaction that takes the
-- stake and pays the win from the character's wallet, so money never moves without its row.
--   Money is in Bronze (1 Silver = 1000 Bronze).
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
		llStake			BIGINT			NOT NULL,	-- Bronze
		llPayout		BIGINT			NOT NULL,	-- Bronze, the stake included
		llWallet		BIGINT			NOT NULL,	-- Bronze, the wallet afterwards
		wMultiple		SMALLINT		NOT NULL	-- the prize as a multiple of the stake, 0 for none
	);
	CREATE INDEX IX_TPORTALSLOTSPIN_USER ON dbo.TPORTALSLOTSPIN (dwUserID, dwID);
END
