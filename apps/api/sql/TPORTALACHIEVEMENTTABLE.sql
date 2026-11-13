-- Achievement levels the portal has awarded, written by TPortalAchievementAward together with the
-- letter that carries the reward, so a level is never paid twice and never recorded without its
-- letter. The portal's "Latest news" reads szText from here.
--   A character achievement is awarded to one character (dwCharID) in one of its lives (bRebirth,
--   0 until rebirth exists). Raising a character's bRebirth makes every level earnable again and
--   keeps the earlier rows as history.
--   An account achievement has dwCharID 0 and sends no letter (dwPostID 0).
-- Emptied by the season reset, like the characters it points at.
IF OBJECT_ID('dbo.TPORTALACHIEVEMENTTABLE', 'U') IS NULL
	CREATE TABLE dbo.TPORTALACHIEVEMENTTABLE (
		dwID			INT IDENTITY(1,1)	NOT NULL CONSTRAINT PK_TPORTALACHIEVEMENTTABLE PRIMARY KEY,
		dwUserID		INT				NOT NULL,
		dwCharID		INT				NOT NULL,	-- 0 for an account achievement
		bRebirth		TINYINT			NOT NULL,
		szAchievement	VARCHAR(40)		NOT NULL,
		bLevel			TINYINT			NOT NULL,
		dwPostID		INT				NOT NULL,	-- 0 when no letter was sent
		dEarned			DATETIME		NOT NULL CONSTRAINT DF_TPORTALACHIEVEMENTTABLE_dEarned DEFAULT GETDATE(),
		dwGold			INT				NOT NULL,	-- what the letter carried
		dwSilver		INT				NOT NULL,
		dwCooper		INT				NOT NULL,
		szItems			VARCHAR(60)		NOT NULL,	-- '7602x5,7654x1', empty for none
		szText			VARCHAR(200)	NOT NULL,	-- the announcement line
		bAnnounced		TINYINT			NOT NULL CONSTRAINT DF_TPORTALACHIEVEMENTTABLE_bAnnounced DEFAULT 0,	-- 0 waiting, 1 sent, 2 skipped
		CONSTRAINT UQ_TPORTALACHIEVEMENTTABLE UNIQUE (dwUserID, dwCharID, szAchievement, bLevel, bRebirth)
	);