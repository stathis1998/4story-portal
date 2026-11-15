-- How many times each character has been reborn, and the stat bonus that earns it. Written by the portal's
-- rebirth batch; the map server reads only bStatBonus, a percentage, when it loads the character.
--   bStatBonus is min(bRebirth, the GM's limit) times the GM's percent, worked out by the portal.
IF OBJECT_ID('dbo.TCHARREBIRTHTABLE', 'U') IS NULL
	CREATE TABLE dbo.TCHARREBIRTHTABLE (
		dwCharID		INT			NOT NULL CONSTRAINT PK_TCHARREBIRTHTABLE PRIMARY KEY,
		bRebirth		TINYINT		NOT NULL CONSTRAINT CK_TCHARREBIRTHTABLE_bRebirth CHECK (bRebirth >= 1),
		bStatBonus		TINYINT		NOT NULL CONSTRAINT CK_TCHARREBIRTHTABLE_bStatBonus CHECK (bStatBonus <= 100),	-- percent
		dUpdate			DATETIME	NOT NULL CONSTRAINT DF_TCHARREBIRTHTABLE_dUpdate DEFAULT GETDATE()
	);
