-- Letters from the portal (TPortalGmPost) waiting for the world server to tell an online recipient
-- "you have new mail". TGetReservedPost hands them out; rows older than 10 minutes are dropped there.
IF OBJECT_ID('dbo.TPORTALPOSTNOTIFY', 'U') IS NULL
	CREATE TABLE dbo.TPORTALPOSTNOTIFY (
		dwPostID	INT			NOT NULL CONSTRAINT PK_TPORTALPOSTNOTIFY PRIMARY KEY,
		dwCharID	INT			NOT NULL,
		dCreated	DATETIME	NOT NULL CONSTRAINT DF_TPORTALPOSTNOTIFY_dCreated DEFAULT GETDATE()
	);
