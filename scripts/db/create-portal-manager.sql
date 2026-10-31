/*
  Creates (or updates the password of) the TMANAGER account the portal uses to log in to
  TControlSvr for GM teleports: szID = 'portal', bAuthority = 3.

  Runs against TGLOBAL_GSP_TEST by default. It refuses any database whose name does not end in
  _TEST unless ALLOW_LIVE is 1, so the live database is a deliberate manual step.

  Run:  sqlcmd -S "localhost\FOURSTORY" -E -C -b -i scripts/db/create-portal-manager.sql -v PORTAL_PASSWORD=...
  Live: set DB to TGLOBAL_GSP and ALLOW_LIVE to 1 in the setvar lines below (sqlcmd -v cannot override them).

  PORTAL_PASSWORD must match CONTROL_PASSWORD in .env (1-50 printable ASCII characters, no single quotes).
*/
:setvar DB TGLOBAL_GSP_TEST
:setvar ALLOW_LIVE 0

:on error exit
USE [$(DB)];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Guard: only touch a _TEST database unless ALLOW_LIVE=1 was passed.
IF DB_NAME() NOT LIKE N'%[_]TEST' AND N'$(ALLOW_LIVE)' <> N'1'
    RAISERROR (N'Refusing to run against a non-_TEST database. Set ALLOW_LIVE to 1 in the script to override.', 16, 1);
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
