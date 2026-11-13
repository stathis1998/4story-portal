-- Awards one achievement level: sends the letter through TPortalGmPost and records the award, in one
-- transaction. Returns the new dwID, 0 when the level was already awarded, or -1 when the character
-- does not exist or is deleted. Nothing is written in either case, so both end with a COMMIT: that
-- keeps a caller's own transaction intact.
CREATE OR ALTER PROCEDURE dbo.TPortalAchievementAward
	@dwUserID		INT,
	@szAchievement	VARCHAR(40),
	@bLevel			TINYINT,
	@pCharID		INT,
	@pSender		VARCHAR(50),
	@pTitle			VARCHAR(240),
	@pMessage		VARCHAR(2000),
	@dwGold			INT,
	@dwSilver		INT,
	@dwCooper		INT,
	@wItemID1		SMALLINT,
	@bCount1		TINYINT,
	@wItemID2		SMALLINT,
	@bCount2		TINYINT,
	@wItemID3		SMALLINT,
	@bCount3		TINYINT,
	@szText			VARCHAR(200)
AS
BEGIN
	SET NOCOUNT ON;
	SET XACT_ABORT ON;

	DECLARE @dwPostID INT, @dwID INT, @szItems VARCHAR(60) = '';

	BEGIN TRAN;

	-- Held to the end of the transaction, so two calls for the same level can't both get past here.
	IF EXISTS (SELECT 1 FROM TPORTALACHIEVEMENTTABLE WITH (UPDLOCK, HOLDLOCK)
		WHERE dwUserID = @dwUserID AND szAchievement = @szAchievement AND bLevel = @bLevel)
	BEGIN
		COMMIT;
		RETURN 0;
	END

	EXEC @dwPostID = dbo.TPortalGmPost
		@pCharID = @pCharID, @pSender = @pSender, @pTitle = @pTitle, @pMessage = @pMessage,
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
