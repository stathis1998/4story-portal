-- The slot machines' three jackpots, one row each, grown by lost rounds and emptied when they drop. Each is changed
-- in the same transaction as the spin that moves it, so the pots and the wallets never disagree.
--   bID 1 is the Giga: the one pot from before the three, with everything it held. 2 is the Mini, 3 the Major.
--   Money is in Bronze (1 Silver = 1000 Bronze).
--   llCap is the cap, in Bronze, that the pot runs under: set when a lost round first adds to an empty pot, and
--   NULL until then. A GM changing the cap later does not change a pot already growing.
IF OBJECT_ID('dbo.TPORTALSLOTJACKPOT', 'U') IS NULL
BEGIN
	CREATE TABLE dbo.TPORTALSLOTJACKPOT (
		bID				TINYINT			NOT NULL CONSTRAINT PK_TPORTALSLOTJACKPOT PRIMARY KEY CONSTRAINT CK_TPORTALSLOTJACKPOT_ID CHECK (bID BETWEEN 1 AND 3),
		llPot			BIGINT			NOT NULL CONSTRAINT DF_TPORTALSLOTJACKPOT_llPot DEFAULT 0,	-- Bronze in the pot
		llCap			BIGINT			NULL		-- Bronze, the cap this pot runs under
	);
END

-- A table made before the three pots allows only row 1; its check is replaced by one that allows rows 1 to 3.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.TPORTALSLOTJACKPOT') AND name = 'CK_TPORTALSLOTJACKPOT_ID' AND definition = '([bID]=(1))')
	ALTER TABLE dbo.TPORTALSLOTJACKPOT DROP CONSTRAINT CK_TPORTALSLOTJACKPOT_ID;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.TPORTALSLOTJACKPOT') AND name = 'CK_TPORTALSLOTJACKPOT_ID')
	ALTER TABLE dbo.TPORTALSLOTJACKPOT ADD CONSTRAINT CK_TPORTALSLOTJACKPOT_ID CHECK (bID BETWEEN 1 AND 3);

IF NOT EXISTS (SELECT 1 FROM dbo.TPORTALSLOTJACKPOT WHERE bID = 1)
	INSERT INTO dbo.TPORTALSLOTJACKPOT (bID) VALUES (1);
IF NOT EXISTS (SELECT 1 FROM dbo.TPORTALSLOTJACKPOT WHERE bID = 2)
	INSERT INTO dbo.TPORTALSLOTJACKPOT (bID) VALUES (2);
IF NOT EXISTS (SELECT 1 FROM dbo.TPORTALSLOTJACKPOT WHERE bID = 3)
	INSERT INTO dbo.TPORTALSLOTJACKPOT (bID) VALUES (3);
