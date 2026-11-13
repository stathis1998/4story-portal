-- Awards one achievement level and records it, in one transaction.
--   @dwCharID <> 0: a character achievement. That character gets a letter through TPortalGmPost,
--                   with the reward saved for the level in TPORTALACHIEVEMENTREWARD.
--   @dwCharID = 0:  an account achievement. No letter and no reward: it is only recorded.
-- Returns the new dwID, or
--    0 when the level was already awarded (to this character in this life, or to this account),
--   -1 when the character does not exist or is deleted,
--   -2 while rewards are switched off (TPORTALSETTING 'achievements_live').
-- Nothing is written in those three cases, so they end with a COMMIT: that keeps a caller's own
-- transaction intact.
CREATE OR ALTER PROCEDURE dbo.TPortalAchievementAward
	@dwUserID		INT,
	@dwCharID		INT,
	@bRebirth		TINYINT,
	@szAchievement	VARCHAR(40),
	@bLevel			TINYINT,
	@pSender		VARCHAR(50),
	@pTitle			VARCHAR(240),
	@pMessage		VARCHAR(1800),
	@pRewardNote	VARCHAR(200),	-- added to the message when the level pays something
	@szText			VARCHAR(200)
AS
BEGIN
	SET NOCOUNT ON;
	SET XACT_ABORT ON;

	DECLARE @dwPostID INT = 0, @dwID INT, @szItems VARCHAR(60) = '', @szMessage VARCHAR(2000) = @pMessage,
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
		WHERE dwUserID = @dwUserID AND dwCharID = @dwCharID AND szAchievement = @szAchievement
			AND bLevel = @bLevel AND bRebirth = @bRebirth)
	BEGIN
		COMMIT;
		RETURN 0;
	END

	IF @dwCharID <> 0
	BEGIN
		SELECT @dwGold = dwGold, @dwSilver = dwSilver, @dwCooper = dwCooper,
			@wItemID1 = wItemID1, @bCount1 = bCount1,
			@wItemID2 = wItemID2, @bCount2 = bCount2,
			@wItemID3 = wItemID3, @bCount3 = bCount3
		FROM TPORTALACHIEVEMENTREWARD
		WHERE szAchievement = @szAchievement AND bLevel = @bLevel;

		IF @dwGold + @dwSilver + @dwCooper > 0 OR @wItemID1 <> 0 OR @wItemID2 <> 0 OR @wItemID3 <> 0
			SET @szMessage = @pMessage + @pRewardNote;

		EXEC @dwPostID = dbo.TPortalGmPost
			@pCharID = @dwCharID, @pSender = @pSender, @pTitle = @pTitle, @pMessage = @szMessage,
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

	INSERT INTO TPORTALACHIEVEMENTTABLE
		(dwUserID, dwCharID, bRebirth, szAchievement, bLevel, dwPostID, dwGold, dwSilver, dwCooper, szItems, szText)
	VALUES
		(@dwUserID, @dwCharID, @bRebirth, @szAchievement, @bLevel, @dwPostID, @dwGold, @dwSilver, @dwCooper, @szItems, @szText);

	SET @dwID = SCOPE_IDENTITY();

	COMMIT;
	RETURN @dwID;
END