CREATE OR ALTER PROCEDURE [dbo].[TGetReservedPost] 
	@dwPostID	INT 		OUTPUT,
	@dwSenderID 	INT 		OUTPUT,
	@dwRecverID	INT		OUTPUT,
	@szSender 	VARCHAR(50) 	OUTPUT,
	@szRecver	VARCHAR(50)	OUTPUT,
	@szTitle	VARCHAR(256) 	OUTPUT,
	@szMessage	VARCHAR(2048) OUTPUT,
	@dlID		BIGINT 		OUTPUT,
	@bItemID	TINYINT 	OUTPUT,
	@wItemID	SMALLINT 	OUTPUT,
	@bLevel	TINYINT 	OUTPUT,
	@bCount	TINYINT 	OUTPUT,
	@bGLevel	TINYINT 	OUTPUT,
	@dwDuraMax	INT		OUTPUT,
	@dwDuraCUr	INT		OUTPUT,
	@bRefineCur	TINYINT	OUTPUT,
	@dEndTime	SMALLDATETIME OUTPUT,
	@bGradeEffect	TINYINT	OUTPUT,
	@bMagic1	TINYINT	OUTPUT,
	@bMagic2	TINYINT	OUTPUT,
	@bMagic3	TINYINT	OUTPUT,
	@bMagic4	TINYINT	OUTPUT,
	@bMagic5	TINYINT	OUTPUT,
	@bMagic6	TINYINT	OUTPUT,
	@wValue1	SMALLINT	OUTPUT,
	@wValue2	SMALLINT	OUTPUT,
	@wValue3	SMALLINT	OUTPUT,
	@wValue4	SMALLINT	OUTPUT,
	@wValue5	SMALLINT	OUTPUT,
	@wValue6	SMALLINT	OUTPUT,
	@dwTime1	INT		OUTPUT,
	@dwTime2	INT		OUTPUT,
	@dwTime3	INT		OUTPUT,
	@dwTime4	INT		OUTPUT,
	@dwTime5	INT		OUTPUT,
	@dwTime6	INT		OUTPUT,
	@bGem  		TINYINT OUTPUT,
	@wMoggItemID smallint OUTPUT

 AS

DECLARE @Ret	INT
DECLARE @dwSeq 	INT
DECLARE @CurTime	SMALLDATETIME
DECLARE @DBID	BIGINT
DECLARE @dwCount 	INT
DECLARE @TdwPostID INT
DECLARE @TdwRecverID INT

SET @bItemID = 0

-- [Portal GM mail, added 2026-11-11] The world server calls this every minute, up to 30 times, and
-- tells the recipient of every post id it gets back with RETURN 0 that new mail arrived. Letters the
-- portal wrote directly (TPortalGmPost) queue a row in TPORTALPOSTNOTIFY; hand those out first, one
-- per call, without writing anything. Rows older than 10 minutes, or whose letter is gone, are
-- dropped. Everything after this block is the game's original procedure, unchanged.
DECLARE @dwNotifyPostID INT
DECLARE @dNotifyCreated DATETIME
WHILE 1 = 1
BEGIN
	SET @dwNotifyPostID = NULL
	SELECT TOP 1 @dwNotifyPostID = dwPostID, @dwRecverID = dwCharID, @dNotifyCreated = dCreated
		FROM TPORTALPOSTNOTIFY ORDER BY dwPostID
	IF @dwNotifyPostID IS NULL
		BREAK

	DELETE FROM TPORTALPOSTNOTIFY WHERE dwPostID = @dwNotifyPostID

	IF @dNotifyCreated >= DATEADD(MINUTE, -10, GETDATE())
	BEGIN
		SELECT @szSender = p.szSender, @szTitle = p.szTitle, @szRecver = c.szName
			FROM TPOSTTABLE p JOIN TCHARTABLE c ON c.dwCharID = p.dwCharID
			WHERE p.dwPostID = @dwNotifyPostID AND p.dwCharID = @dwRecverID
		IF @@ROWCOUNT = 1
		BEGIN
			SELECT @dwPostID = @dwNotifyPostID, @dwSenderID = 0, @szMessage = '',
				@dlID = 0, @wItemID = 0, @bLevel = 0, @bCount = 0, @bGLevel = 0, @dwDuraMax = 0, @dwDuraCUr = 0,
				@bRefineCur = 0, @dEndTime = '1900-01-01', @bGradeEffect = 0,
				@bMagic1 = 0, @bMagic2 = 0, @bMagic3 = 0, @bMagic4 = 0, @bMagic5 = 0, @bMagic6 = 0,
				@wValue1 = 0, @wValue2 = 0, @wValue3 = 0, @wValue4 = 0, @wValue5 = 0, @wValue6 = 0,
				@dwTime1 = 0, @dwTime2 = 0, @dwTime3 = 0, @dwTime4 = 0, @dwTime5 = 0, @dwTime6 = 0,
				@bGem = 0, @wMoggItemID = 0
			RETURN 0
		END
	END
END
SET @dwRecverID = NULL
-- [End of portal GM mail block]

SELECT @dwCount = COUNT(dwSeq) FROM TRESERVEDPOST WHERE bSend = 0

IF(@dwCount = 0)
   RETURN 1


SELECT TOP 1
	@dwSeq = dwSeq, 	
	@dwRecverID = dwRecverID, 
	@szSender = szSender, 	
	@szTitle = szTitle, 
	@szMessage = szMessage, 
	@wItemID = wItemID, 
	@bLevel = bLevel, 
	@bCount = bCount, 
	@bGLevel = bGLevel, 
	@dwDuraMax = dwDuraMax, 
	@dwDuraCur = dwDuraCur, 
	@bRefineCur = bRefineCur, 
	@dEndTime = dEndTime,
	@bGradeEffect = bGradeEffect,
	@bMagic1 = bMagic1, 
	@bMagic2 = bMagic2, 
	@bMagic3 = bMagic3, 
	@bMagic4 = bMagic4, 
	@bMagic5 = bMagic5, 
	@bMagic6 = bMagic6, 
	@wValue1 = wValue1, 
	@wValue2 = wValue2, 
	@wValue3 = wValue3, 
	@wValue4 = wValue4, 
	@wValue5 = wValue5, 
	@wValue6 = wValue6, 
	@dwTime1 = dwTime1, 
	@dwTime2 = dwTime2, 
	@dwTime3 = dwTime3, 
	@dwTime4 = dwTime4, 
	@dwTime5 = dwTime5, 
	@dwTime6 = dwTime6,
	@bGem		= bGem,
	@wMoggItemID = wMoggItemID

	FROM TRESERVEDPOST WHERE bSend = 0
	
	SELECT @szRecver = szName FROM TCHARTABLE WHERE dwCharID = @dwRecverID
	IF(@@ROWCOUNT = 0 OR @szRecver IS NULL )
	BEGIN
		UPDATE TRESERVEDPOST SET bSend = 2 WHERE dwSeq = @dwSeq
		RETURN 2
	END
	
	SET @dwSenderID = 0
	SELECT @dwSenderID = dwCharID FROM TCHARTABLE WHERE szName = @szSender	

	SELECT @CurTime = (SELECT CONVERT( SMALLDATETIME , GETDATE() ) )
	
	EXEC @Ret = TSavePost @TdwPostID OUTPUT, @TdwRecverID OUTPUT, @dwSenderID, @dwRecverID, @szRecver, @szSender, @szTitle, @szMessage, 0,1,0,0,0,  @CurTime

	-- ???? ?? ??
	IF ( @Ret > 0 )
	BEGIN
		UPDATE TRESERVEDPOST SET bSend = 2 WHERE dwSeq = @dwSeq
		RETURN 2
	END

	SET @dwPostID = @TdwPostID

	EXEC TGenerateDBItemID @DBID OUTPUT
	SET @dlID = @DBID

	EXEC @Ret = TSaveItemDirect @dlID, 2 , @dwPostID, 0, @dwRecverID, 
			@bItemID,@wItemID,@bLevel,@bCount,@bGLevel,
			@dwDuraMax,@dwDuraCur,@bRefineCur,@dEndTime,@bGradeEffect,
			@bMagic1,@bMagic2,@bMagic3,@bMagic4,@bMagic5,@bMagic6,
			@wValue1,@wValue2,@wValue3,@wValue4,@wValue5,@wValue6,
			@dwTime1,@dwTime2,@dwTime3,@dwTime4,@dwTime5,@dwTime6,@bGem,@wMoggItemID

	UPDATE TRESERVEDPOST SET bSend = 1 WHERE dwSeq = @dwSeq
	
	RETURN 0

