-- What each achievement level pays, set by a GM on the portal. A level with no row pays nothing.
-- TPortalAchievementAward reads it inside the award's own transaction. Kept through the season reset.
IF OBJECT_ID('dbo.TPORTALACHIEVEMENTREWARD', 'U') IS NULL
	CREATE TABLE dbo.TPORTALACHIEVEMENTREWARD (
		szAchievement	VARCHAR(40)	NOT NULL,
		bLevel			TINYINT		NOT NULL,
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
		dUpdated		DATETIME	NOT NULL CONSTRAINT DF_TPORTALACHIEVEMENTREWARD_dUpdated DEFAULT GETDATE(),
		CONSTRAINT PK_TPORTALACHIEVEMENTREWARD PRIMARY KEY (szAchievement, bLevel)
	);