/*
  Creates (or updates the password of) the TMANAGER account the portal uses to log in to
  TControlSvr for GM teleports: szID = 'portal', bAuthority = 3.

  TControlSvr checks logins against the live TGLOBAL_GSP, so that is where the account must exist.
  DB, ALLOW_LIVE and PORTAL_PASSWORD all come from the command line; sqlcmd stops before doing
  anything if one is missing. A database whose name does not end in _TEST is refused unless
  ALLOW_LIVE is 1.

  sqlcmd -S "localhost\FOURSTORY" -E -C -b -i scripts/db/create-portal-manager.sql \
         -v DB=TGLOBAL_GSP ALLOW_LIVE=1 PORTAL_PASSWORD=...

  PORTAL_PASSWORD must match CONTROL_PASSWORD in .env (1-50 printable ASCII characters, no single quotes).
*/
:on error exit
USE [$(DB)];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Guard: only touch a _TEST database unless ALLOW_LIVE=1 was passed.
IF DB_NAME() NOT LIKE N'%[_]TEST' AND N'$(ALLOW_LIVE)' <> N'1'
    RAISERROR (N'Refusing to run against a non-_TEST database. Pass -v ALLOW_LIVE=1 to override.', 16, 1);
GO

IF EXISTS (SELECT 1 FROM TMANAGER WHERE szID = N'portal')
BEGIN
    UPDATE TMANAGER SET szPasswd = N'$(PORTAL_PASSWORD)', bAuthority = 3 WHERE szID = N'portal';
    PRINT N'Updated TMANAGER portal in ' + DB_NAME();
END
ELSE
BEGIN
    INSERT INTO TMANAGER (szID, szPasswd, bAuthority) VALUES (N'portal', N'$(PORTAL_PASSWORD)', 3);
    PRINT N'Inserted TMANAGER portal in ' + DB_NAME();
END
GO
