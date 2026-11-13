-- Achievement levels the portal has awarded. One row per account, achievement and level, written by
-- TPortalAchievementAward together with the letter that carries the reward, so a level is never paid
-- twice and never recorded without its letter. The portal's "Latest news" reads szText from here.
-- Emptied by the season reset, like the characters it points at.
IF OBJECT_ID('dbo.TPORTALACHIEVEMENTTABLE', 'U') IS NULL
	CREATE TABLE dbo.TPORTALACHIEVEMENTTABLE (
		dwID			INT IDENTITY(1,1)	NOT NULL CONSTRAINT PK_TPORTALACHIEVEMENTTABLE PRIMARY KEY,
		dwUserID		INT				NOT NULL,
		szAchievement	VARCHAR(40)		NOT NULL,
		bLevel			TINYINT			NOT NULL,
		dwCharID		INT				NOT NULL,	-- who got the letter
		dwPostID		INT				NOT NULL,
		dEarned			DATETIME		NOT NULL CONSTRAINT DF_TPORTALACHIEVEMENTTABLE_dEarned DEFAULT GETDATE(),
		dwGold			INT				NOT NULL,	-- what the letter carried
		dwSilver		INT				NOT NULL,
		dwCooper		INT				NOT NULL,
		szItems			VARCHAR(60)		NOT NULL,	-- '7602x5,7654x1', empty for none
		szText			VARCHAR(200)	NOT NULL,	-- the announcement line
		bAnnounced		TINYINT			NOT NULL CONSTRAINT DF_TPORTALACHIEVEMENTTABLE_bAnnounced DEFAULT 0,	-- 0 waiting, 1 sent, 2 skipped
		CONSTRAINT UQ_TPORTALACHIEVEMENTTABLE UNIQUE (dwUserID, szAchievement, bLevel)
	);
