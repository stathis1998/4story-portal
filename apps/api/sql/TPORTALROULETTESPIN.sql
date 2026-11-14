-- Every spin of the portal's roulette, written by the bet batch in the same transaction that takes the
-- stake and pays the win from the character's wallet, so money never moves without its row.
--   Money is in Bronze (1 Silver = 1000 Bronze); szBets keeps what was staked where, in Silver.
--   The character's name is copied here, so a rename or delete later does not change history.
IF OBJECT_ID('dbo.TPORTALROULETTESPIN', 'U') IS NULL
BEGIN
	CREATE TABLE dbo.TPORTALROULETTESPIN (
		dwID			INT IDENTITY(1,1)	NOT NULL CONSTRAINT PK_TPORTALROULETTESPIN PRIMARY KEY,
		dwUserID		INT				NOT NULL,	-- the account
		dwCharID		INT				NOT NULL,	-- whose wallet paid and was paid
		szCharName		VARCHAR(50)		NOT NULL,
		dSpun			DATETIME		NOT NULL CONSTRAINT DF_TPORTALROULETTESPIN_dSpun DEFAULT GETDATE(),
		bPocket			TINYINT			NOT NULL,	-- 0 to 36
		llStake			BIGINT			NOT NULL,	-- Bronze
		llPayout		BIGINT			NOT NULL,	-- Bronze, the stake on winning bets included
		llWallet		BIGINT			NOT NULL,	-- Bronze, the wallet afterwards
		szBets			VARCHAR(1000)	NOT NULL,	-- 'n17:100,red:500', amounts in Silver
		bNumberHit		TINYINT			NOT NULL	-- 1 when a number bet won
	);
	CREATE INDEX IX_TPORTALROULETTESPIN_USER ON dbo.TPORTALROULETTESPIN (dwUserID, dwID);
END
