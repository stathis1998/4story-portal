-- Each account's meter on the portal's slot machines: one row per account, machine and stake. A paid spin whose
-- last window shows one or two scatters adds that many points; at the machine's size the meter pays its free
-- spins and keeps the points over the size. Written only by the bet batch, in the same transaction as the spin
-- that moves it, after it has locked the account's online-list rows and the character, and before the pots.
--   dwStake is whole Silver: points earned at one stake are only cashed at that stake.
--   A meter left at 0 by a round that found no row writes none; a row once there stays, at 0 too.
IF OBJECT_ID('dbo.TPORTALSLOTMETER', 'U') IS NULL
BEGIN
	CREATE TABLE dbo.TPORTALSLOTMETER (
		dwUserID		INT				NOT NULL,	-- the account
		szMachine		VARCHAR(20)		NOT NULL,	-- 'shelf', 'armoury', 'hoard'
		dwStake			INT				NOT NULL,	-- Silver
		bPoints			TINYINT			NOT NULL,
		dUpdated		DATETIME		NOT NULL CONSTRAINT DF_TPORTALSLOTMETER_dUpdated DEFAULT GETDATE(),
		CONSTRAINT PK_TPORTALSLOTMETER PRIMARY KEY (dwUserID, szMachine, dwStake)
	);
END
