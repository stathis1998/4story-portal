-- Awards one achievement level: sends the letter through TPortalGmPost, with the reward saved for the
-- level in TPORTALACHIEVEMENTREWARD, and records the award, in one transaction.
-- Returns the new dwID, or
--    0 when the level was already awarded,
--   -1 when the character does not exist or is deleted,
--   -2 while rewards are switched off (TPORTALSETTING 'achievements_live').
-- Nothing is written in those three cases, so they end with a COMMIT: that keeps a caller's own
-- transaction intact.
CREATE OR ALTER PROCEDURE dbo.TPortalAchievementAward
	@dwUserID		INT,
	@szAchievement	VARCHAR(40),
	@bLevel			TINYINT,
	@pCharID		INT,
	@pSender		VARCHAR(50),
	@pTitle			VARCHAR(240),
	@pMessage		VARCHAR(1800),
	@pRewardNote	VARCHAR(200),	-- added to the message when the level pays something
	@szText			VARCHAR(200)
AS
BEGIN
	SET NOCOUNT ON;
	SET XACT_ABORT ON;

	DECLARE @dwPostID INT, @dwID INT, @szItems VARCHAR(60) = '', @szMessage VARCHAR(2000) = @pMessage,
		@dwGold INT = 0, @dwSilver INT = 0, @dwCooper INT = 0,
		@wItemID1 SMALLINT = 0, @bCount1 TINYINT = 0,
		@wItemID2 SMALLINT = 0, @bCount2 TINYINT = 0,
		@wItemID3 SMALLINT = 0, @bCount3 TINYINT = 0;

	BEGIN TRAN;

	IF NOT EXISTS (SELECT 1 FROM TPORTALSETTING WHERE szKey = 'achievements_live' AND szValue = 'true')
	BEGIN
		COMMIT;
		RETURN -2;
	END

	-- Held to the end of the transaction, so two calls for the same level can't both get past here.
	IF EXISTS (SELECT 1 FROM TPORTALACHIEVEMENTTABLE WITH (UPDLOCK, HOLDLOCK)
		WHERE dwUserID = @dwUserID AND szAchievement = @szAchievement AND bLevel = @bLevel)
	BEGIN
		COMMIT;
		RETURN 0;
	END

	SELECT @dwGold = dwGold, @dwSilver = dwSilver, @dwCooper = dwCooper,
		@wItemID1 = wItemID1, @bCount1 = bCount1,
		@wItemID2 = wItemID2, @bCount2 = bCount2,
		@wItemID3 = wItemID3, @bCount3 = bCount3
	FROM TPORTALACHIEVEMENTREWARD
	WHERE szAchievement = @szAchievement AND bLevel = @bLevel;

	IF @dwGold + @dwSilver + @dwCooper > 0 OR @wItemID1 <> 0 OR @wItemID2 <> 0 OR @wItemID3 <> 0
		SET @szMessage = @pMessage + @pRewardNote;

	EXEC @dwPostID = dbo.TPortalGmPost
		@pCharID = @pCharID, @pSender = @pSender, @pTitle = @pTitle, @pMessage = @szMessage,
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

	INSERT INTO TPORTALACHIEVEMENTTABLE
		(dwUserID, szAchievement, bLevel, dwCharID, dwPostID, dwGold, dwSilver, dwCooper, szItems, szText)
	VALUES
		(@dwUserID, @szAchievement, @bLevel, @pCharID, @dwPostID, @dwGold, @dwSilver, @dwCooper, @szItems, @szText);

	SET @dwID = SCOPE_IDENTITY();

	COMMIT;
	RETURN @dwID;
END