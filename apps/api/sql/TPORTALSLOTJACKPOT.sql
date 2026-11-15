-- The slot machines' shared jackpot: one row, grown by lost rounds and emptied when it drops. It is changed in
-- the same transaction as the spin that moves it, so the pot and the wallets never disagree.
--   Money is in Bronze (1 Silver = 1000 Bronze).
--   llCap is the cap, in Bronze, that the pot runs under: set when a lost round first adds to an empty pot, and
--   NULL until then. A GM changing the cap later does not change a pot already growing.
IF OBJECT_ID('dbo.TPORTALSLOTJACKPOT', 'U') IS NULL
BEGIN
	CREATE TABLE dbo.TPORTALSLOTJACKPOT (
		bID				TINYINT			NOT NULL CONSTRAINT PK_TPORTALSLOTJACKPOT PRIMARY KEY CONSTRAINT CK_TPORTALSLOTJACKPOT_ID CHECK (bID = 1),
		llPot			BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTJACKPOT_llPot DEFAULT 0,	-- Bronze in the pot
		llCap			BIGINT			NULL		-- Bronze, the cap this pot runs under
	);
END
IF NOT EXISTS (SELECT 1 FROM dbo.TPORTALSLOTJACKPOT WHERE bID = 1)
	INSERT INTO dbo.TPORTALSLOTJACKPOT (bID) VALUES (1);
