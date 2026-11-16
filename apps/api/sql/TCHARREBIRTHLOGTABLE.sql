-- One row per rebirth, written by the portal's rebirth batch in the same transaction that resets the
-- character and takes the price, so a rebirth never happens without its row.
--   The character's name is copied here, so a rename or delete later does not change history.
--   szBaseline holds the character's achievement counters at the moment of rebirth (JSON); progress in
--   the new life is the current number minus it.
IF OBJECT_ID('dbo.TCHARREBIRTHLOGTABLE', 'U') IS NULL
	CREATE TABLE dbo.TCHARREBIRTHLOGTABLE (
		dwID			INT IDENTITY(1,1)	NOT NULL CONSTRAINT PK_TCHARREBIRTHLOGTABLE PRIMARY KEY,
		dwUserID		INT				NOT NULL,	-- the account
		dwCharID		INT				NOT NULL,
		szCharName		VARCHAR(50)		NOT NULL,
		bRebirth		TINYINT			NOT NULL,	-- the character's rebirth number after this one
		bStatBonus		TINYINT			NOT NULL,	-- percent, after this one
		dwPriceGold		INT				NOT NULL,	-- Gold paid
		szBaseline		VARCHAR(2000)	NOT NULL,	-- JSON
		szText			VARCHAR(160)	NOT NULL,	-- the announcement, names filled in
		bAnnounced		TINYINT			NOT NULL CONSTRAINT DF_TCHARREBIRTHLOGTABLE_bAnnounced DEFAULT 0,
		dRebirth		DATETIME		NOT NULL CONSTRAINT DF_TCHARREBIRTHLOGTABLE_dRebirth DEFAULT GETDATE(),
		dwPostID		INT				NOT NULL CONSTRAINT DF_TCHARREBIRTHLOGTABLE_dwPostID DEFAULT 0,	-- the reward letter, 0 for none
		CONSTRAINT UQ_TCHARREBIRTHLOGTABLE_CHAR_REBIRTH UNIQUE (dwCharID, bRebirth)
	);
GO
-- A table made before the reward letter gets the column here.
IF COL_LENGTH('dbo.TCHARREBIRTHLOGTABLE', 'dwPostID') IS NULL
	ALTER TABLE dbo.TCHARREBIRTHLOGTABLE ADD dwPostID INT NOT NULL CONSTRAINT DF_TCHARREBIRTHLOGTABLE_dwPostID DEFAULT 0;