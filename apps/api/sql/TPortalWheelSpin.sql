-- One spin of the portal's Wheel of Fortune: checks it is allowed, sends the prize to the character
-- as a letter through TPortalGmPost and records the spin, in one transaction.
-- The portal picks the prize; this procedure reads what it pays, so the reward is the one saved at
-- this moment.
--   {prize} in @pTitle, @pMessage and @szText becomes the prize's name, {name} the character's.
-- Returns the new dwID, or
--    0 when the account has already spun today (the database's own date),
--   -1 when the character is not this account's, is deleted or is under @bMinLevel,
--   -2 while the wheel is switched off (TPORTALSETTING 'wheel_live'),
--   -3 when the prize does not exist or is disabled.
-- Nothing is written in those four cases, so they end with a COMMIT: that keeps a caller's own
-- transaction intact.
CREATE OR ALTER PROCEDURE dbo.TPortalWheelSpin
	@dwUserID		INT,
	@dwCharID		INT,
	@dwPrizeID		INT,
	@bMinLevel		TINYINT,
	@pSender		VARCHAR(50),
	@pTitle			VARCHAR(200),
	@pMessage		VARCHAR(1800),
	@szText			VARCHAR(160)
AS
BEGIN
	SET NOCOUNT ON;
	SET XACT_ABORT ON;

	DECLARE @dDay DATE = CAST(GETDATE() AS DATE), @dwPostID INT = 0, @dwID INT,
		@szCharName VARCHAR(50), @szPrize VARCHAR(40), @bAnnounce TINYINT, @szItems VARCHAR(60) = '',
		@szTitle VARCHAR(240), @szMessage VARCHAR(2000), @szLine VARCHAR(200),
		@dwGold INT, @dwSilver INT, @dwCooper INT,
		@wItemID1 SMALLINT, @bCount1 TINYINT,
		@wItemID2 SMALLINT, @bCount2 TINYINT,
		@wItemID3 SMALLINT, @bCount3 TINYINT;

	BEGIN TRAN;

	IF NOT EXISTS (SELECT 1 FROM TPORTALSETTING WHERE szKey = 'wheel_live' AND szValue = 'true')
	BEGIN
		COMMIT;
		RETURN -2;
	END

	-- Held to the end of the transaction, so two spins by one account can't both get past here.
	IF EXISTS (SELECT 1 FROM TPORTALWHEELSPINTABLE WITH (UPDLOCK, HOLDLOCK) WHERE dwUserID = @dwUserID AND dDay = @dDay)
	BEGIN
		COMMIT;
		RETURN 0;
	END

	SELECT @szCharName = szName FROM TCHARTABLE
	WHERE dwCharID = @dwCharID AND dwUserID = @dwUserID AND bDelete = 0 AND bLevel >= @bMinLevel;
	IF @szCharName IS NULL
	BEGIN
		COMMIT;
		RETURN -1;
	END

	SELECT @szPrize = szName, @bAnnounce = bAnnounce,
		@dwGold = dwGold, @dwSilver = dwSilver, @dwCooper = dwCooper,
		@wItemID1 = wItemID1, @bCount1 = bCount1,
		@wItemID2 = wItemID2, @bCount2 = bCount2,
		@wItemID3 = wItemID3, @bCount3 = bCount3
	FROM TPORTALWHEELPRIZE
	WHERE dwID = @dwPrizeID AND bEnabled = 1;
	IF @szPrize IS NULL
	BEGIN
		COMMIT;
		RETURN -3;
	END

	SET @szTitle = REPLACE(REPLACE(@pTitle, '{prize}', @szPrize), '{name}', @szCharName);
	SET @szMessage = REPLACE(REPLACE(@pMessage, '{prize}', @szPrize), '{name}', @szCharName);
	SET @szLine = REPLACE(REPLACE(@szText, '{prize}', @szPrize), '{name}', @szCharName);

	-- An empty prize is a "no luck" segment: it uses up the spin and sends nothing.
	IF @dwGold + @dwSilver + @dwCooper > 0 OR @wItemID1 <> 0 OR @wItemID2 <> 0 OR @wItemID3 <> 0
	BEGIN
		EXEC @dwPostID = dbo.TPortalGmPost
			@pCharID = @dwCharID, @pSender = @pSender, @pTitle = @szTitle, @pMessage = @szMessage,
			@dwGold = @dwGold, @dwSilver = @dwSilver, @dwCooper = @dwCooper,
			@wItemID1 = @wItemID1, @bCount1 = @bCount1,
			@wItemID2 = @wItemID2, @bCount2 = @bCount2,
			@wItemID3 = @wItemID3, @bCount3 = @bCount3;

		-- TPortalGmPost returns 0 before it writes anything.
		IF @dwPostID = 0
		BEGIN
			COMMIT;
			RETURN -1;
		END

		IF @wItemID1 <> 0 SET @szItems = CAST(@wItemID1 AS VARCHAR(6)) + 'x' + CAST(@bCount1 AS VARCHAR(3));
		IF @wItemID2 <> 0 SET @szItems = @szItems + CASE WHEN @szItems = '' THEN '' ELSE ',' END + CAST(@wItemID2 AS VARCHAR(6)) + 'x' + CAST(@bCount2 AS VARCHAR(3));
		IF @wItemID3 <> 0 SET @szItems = @szItems + CASE WHEN @szItems = '' THEN '' ELSE ',' END + CAST(@wItemID3 AS VARCHAR(6)) + 'x' + CAST(@bCount3 AS VARCHAR(3));
	END

	INSERT INTO TPORTALWHEELSPINTABLE
		(dwUserID, dDay, dwCharID, szCharName, dwPrizeID, szPrize, dwPostID, dwGold, dwSilver, dwCooper, szItems, szText, bAnnounce, bAnnounced)
	VALUES
		(@dwUserID, @dDay, @dwCharID, @szCharName, @dwPrizeID, @szPrize, @dwPostID, @dwGold, @dwSilver, @dwCooper, @szItems, @szLine,
			@bAnnounce, CASE WHEN @bAnnounce = 1 THEN 0 ELSE 2 END);

	SET @dwID = SCOPE_IDENTITY();

	COMMIT;
	RETURN @dwID;
END
