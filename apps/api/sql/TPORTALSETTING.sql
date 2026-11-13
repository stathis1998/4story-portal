-- Portal settings that have to be the same for every portal process using this game database.
-- 'achievements_live' = 'true' lets TPortalAchievementAward award. Kept through the season reset.
IF OBJECT_ID('dbo.TPORTALSETTING', 'U') IS NULL
	CREATE TABLE dbo.TPORTALSETTING (
		szKey			VARCHAR(40)		NOT NULL CONSTRAINT PK_TPORTALSETTING PRIMARY KEY,
		szValue			VARCHAR(200)	NOT NULL,
		szUpdatedBy		VARCHAR(50)		NOT NULL,
		dUpdated		DATETIME		NOT NULL CONSTRAINT DF_TPORTALSETTING_dUpdated DEFAULT GETDATE()
	);