-- Every spin of the portal's Wheel of Fortune, written by TPortalWheelSpin together with the letter
-- that carries the prize, so a spin is never paid twice and never recorded without its letter.
--   One row per account and day: the unique key is what limits an account to one spin a day.
--   The prize's name and what it paid are copied here, so editing or deleting a prize later does
--   not change history.
IF OBJECT_ID('dbo.TPORTALWHEELSPINTABLE', 'U') IS NULL
	CREATE TABLE dbo.TPORTALWHEELSPINTABLE (
		dwID			INT IDENTITY(1,1)	NOT NULL CONSTRAINT PK_TPORTALWHEELSPINTABLE PRIMARY KEY,
		dwUserID		INT				NOT NULL,
		dDay			DATE			NOT NULL,	-- the server's day this spin used up
		dwCharID		INT				NOT NULL,	-- who got the letter
		szCharName		VARCHAR(50)		NOT NULL,
		dSpun			DATETIME		NOT NULL CONSTRAINT DF_TPORTALWHEELSPINTABLE_dSpun DEFAULT GETDATE(),
		dwPrizeID		INT				NOT NULL,
		szPrize			VARCHAR(40)		NOT NULL,
		dwPostID		INT				NOT NULL,	-- 0 when the prize was empty and no letter was sent
		dwGold			INT				NOT NULL,	-- what the letter carried
		dwSilver		INT				NOT NULL,
		dwCooper		INT				NOT NULL,
		szItems			VARCHAR(60)		NOT NULL,	-- '7602x5,7654x1', empty for none
		szText			VARCHAR(200)	NOT NULL,	-- the announcement line
		bAnnounce		TINYINT			NOT NULL,	-- 1 when the prize was one that is announced
		bAnnounced		TINYINT			NOT NULL,	-- 0 waiting, 1 sent, 2 skipped or never due
		CONSTRAINT UQ_TPORTALWHEELSPINTABLE UNIQUE (dwUserID, dDay)
	);
