-- The prizes on the portal's Wheel of Fortune, edited by a GM on /gm/wheel.
--   A prize's chance is its wWeight out of the total wWeight of the enabled prizes.
--   The reward has the shape of one letter: money and up to 3 items. A prize with no money and no
--   items is a "no luck" segment and sends no letter.
-- TPortalWheelSpin reads the prize inside the spin's own transaction.
-- The ten starting prizes are inserted once, when the table is created. Their names are kept to
-- 22 characters, which is what fits along a segment of the wheel.
IF OBJECT_ID('dbo.TPORTALWHEELPRIZE', 'U') IS NULL
BEGIN
	CREATE TABLE dbo.TPORTALWHEELPRIZE (
		dwID			INT IDENTITY(1,1)	NOT NULL CONSTRAINT PK_TPORTALWHEELPRIZE PRIMARY KEY,
		szName			VARCHAR(40)		NOT NULL,	-- on the wheel, in the letter and in the announcement
		wWeight			SMALLINT		NOT NULL,
		wOrder			SMALLINT		NOT NULL,	-- position on the wheel, lowest first
		bEnabled		TINYINT			NOT NULL CONSTRAINT DF_TPORTALWHEELPRIZE_bEnabled DEFAULT 1,
		bAnnounce		TINYINT			NOT NULL CONSTRAINT DF_TPORTALWHEELPRIZE_bAnnounce DEFAULT 0,	-- 1: a win is said in world chat
		dwGold			INT				NOT NULL,
		dwSilver		INT				NOT NULL,
		dwCooper		INT				NOT NULL,
		wItemID1		SMALLINT		NOT NULL,	-- 0 for an empty slot
		bCount1			TINYINT			NOT NULL,
		wItemID2		SMALLINT		NOT NULL,
		bCount2			TINYINT			NOT NULL,
		wItemID3		SMALLINT		NOT NULL,
		bCount3			TINYINT			NOT NULL,
		szUpdatedBy		VARCHAR(50)		NOT NULL,
		dUpdated		DATETIME		NOT NULL CONSTRAINT DF_TPORTALWHEELPRIZE_dUpdated DEFAULT GETDATE()
	);

	-- The weights add up to 100. Small and big prizes alternate around the wheel.
	INSERT INTO dbo.TPORTALWHEELPRIZE
		(szName, wWeight, wOrder, bAnnounce, dwGold, dwSilver, dwCooper, wItemID1, bCount1, wItemID2, bCount2, wItemID3, bCount3, szUpdatedBy)
	VALUES
		('100 Silver',                        22,  10, 0,  0, 100, 0,    0,  0, 0, 0, 0, 0, 'portal'),
		('Experience Potion',                4,  20, 0,  0,   0, 0, 7714,  1, 0, 0, 0, 0, 'portal'),
		('5 Apprentice Formulas',           16,  30, 0,  0,   0, 0, 8501,  5, 0, 0, 0, 0, 'portal'),
		('1 Gold',                           6,  40, 0,  1,   0, 0,    0,  0, 0, 0, 0, 0, 'portal'),
		('300 Silver',                        15,  50, 0,  0, 300, 0,    0,  0, 0, 0, 0, 0, 'portal'),
		('Master''s Formula',               10,  60, 0,  0,   0, 0, 7602,  1, 0, 0, 0, 0, 'portal'),
		('10 Gold',                          1,  70, 1, 10,   0, 0,    0,  0, 0, 0, 0, 0, 'portal'),
		('2 Serendipity 100%',              10,  80, 0,  0,   0, 0, 7609,  2, 0, 0, 0, 0, 'portal'),
		('Survival Tincture',                8,  90, 0,  0,   0, 0, 7654,  1, 0, 0, 0, 0, 'portal'),
		('10 Healing Potions',               8, 100, 0,  0,   0, 0, 7600, 10, 0, 0, 0, 0, 'portal');
END
