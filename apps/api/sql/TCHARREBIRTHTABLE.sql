-- How many times each character has been reborn, and the stat bonus that earns it. Written by the portal's
-- rebirth batch; the map server reads only bStatBonus, a percentage, when it loads the character.
--   bStatBonus is min(bRebirth, the GM's limit) times the GM's percent, worked out by the portal.
--   bExpBonus and bGoldBonus are the same for EXP and monster Gold, each at most 250 percent; the map server
--   reads all three when it loads the character.
IF OBJECT_ID('dbo.TCHARREBIRTHTABLE', 'U') IS NULL
	CREATE TABLE dbo.TCHARREBIRTHTABLE (
		dwCharID		INT			NOT NULL CONSTRAINT PK_TCHARREBIRTHTABLE PRIMARY KEY,
		bRebirth		TINYINT		NOT NULL CONSTRAINT CK_TCHARREBIRTHTABLE_bRebirth CHECK (bRebirth >= 1),
		bStatBonus		TINYINT		NOT NULL CONSTRAINT CK_TCHARREBIRTHTABLE_bStatBonus CHECK (bStatBonus <= 100),	-- percent
		dUpdate			DATETIME	NOT NULL CONSTRAINT DF_TCHARREBIRTHTABLE_dUpdate DEFAULT GETDATE(),
		bExpBonus		TINYINT		NOT NULL CONSTRAINT DF_TCHARREBIRTHTABLE_bExpBonus DEFAULT 0 CONSTRAINT CK_TCHARREBIRTHTABLE_bExpBonus CHECK (bExpBonus <= 250),	-- percent
		bGoldBonus		TINYINT		NOT NULL CONSTRAINT DF_TCHARREBIRTHTABLE_bGoldBonus DEFAULT 0 CONSTRAINT CK_TCHARREBIRTHTABLE_bGoldBonus CHECK (bGoldBonus <= 250)	-- percent
	);
GO
-- A table made before the EXP and gold bonuses gets the columns here.
IF COL_LENGTH('dbo.TCHARREBIRTHTABLE', 'bExpBonus') IS NULL
	ALTER TABLE dbo.TCHARREBIRTHTABLE ADD bExpBonus TINYINT NOT NULL CONSTRAINT DF_TCHARREBIRTHTABLE_bExpBonus DEFAULT 0 CONSTRAINT CK_TCHARREBIRTHTABLE_bExpBonus CHECK (bExpBonus <= 250);
GO
IF COL_LENGTH('dbo.TCHARREBIRTHTABLE', 'bGoldBonus') IS NULL
	ALTER TABLE dbo.TCHARREBIRTHTABLE ADD bGoldBonus TINYINT NOT NULL CONSTRAINT DF_TCHARREBIRTHTABLE_bGoldBonus DEFAULT 0 CONSTRAINT CK_TCHARREBIRTHTABLE_bGoldBonus CHECK (bGoldBonus <= 250);
