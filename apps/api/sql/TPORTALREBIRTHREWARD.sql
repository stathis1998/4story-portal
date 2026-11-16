-- What each rebirth number pays, set by a GM on the portal: money and up to three items, mailed to the
-- character as one letter. A rebirth with no row pays nothing.
-- Read by the portal's rebirth batch inside the rebirth's own transaction.
-- NOT in the season reset list: kept through the season reset, like the achievement rewards.
IF OBJECT_ID('dbo.TPORTALREBIRTHREWARD', 'U') IS NULL
	CREATE TABLE dbo.TPORTALREBIRTHREWARD (
		bRebirth		TINYINT		NOT NULL CONSTRAINT PK_TPORTALREBIRTHREWARD PRIMARY KEY CONSTRAINT CK_TPORTALREBIRTHREWARD_bRebirth CHECK (bRebirth BETWEEN 1 AND 20),
		dwGold			INT			NOT NULL,
		dwSilver		INT			NOT NULL,
		dwCooper		INT			NOT NULL,
		wItemID1		SMALLINT	NOT NULL,	-- 0 for an empty slot
		bCount1			TINYINT		NOT NULL,
		wItemID2		SMALLINT	NOT NULL,
		bCount2			TINYINT		NOT NULL,
		wItemID3		SMALLINT	NOT NULL,
		bCount3			TINYINT		NOT NULL,
		szUpdatedBy		VARCHAR(50)	NOT NULL,
		dUpdated		DATETIME	NOT NULL CONSTRAINT DF_TPORTALREBIRTHREWARD_dUpdated DEFAULT GETDATE()
	);
