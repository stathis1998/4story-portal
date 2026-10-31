/*
  Creates (or refreshes) test copies of the game databases on this SQL Server instance:

    TGLOBAL_GSP -> TGLOBAL_GSP_TEST
    TGAME_GSP   -> TGAME_GSP_TEST

  The only statement that touches a source database is BACKUP ... WITH COPY_ONLY, which reads it
  and does not affect any backup chain. Everything else targets the _TEST databases.

  Run:  sqlcmd -S "localhost\FOURSTORY" -E -C -b -i scripts/db/create-test-copies.sql
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @pairs TABLE (src sysname NOT NULL, tgt sysname NOT NULL);
INSERT INTO @pairs (src, tgt) VALUES
    (N'TGLOBAL_GSP', N'TGLOBAL_GSP_TEST'),
    (N'TGAME_GSP',   N'TGAME_GSP_TEST');

-- Guard: never restore over anything that is not a _TEST database.
IF EXISTS (SELECT 1 FROM @pairs WHERE tgt NOT LIKE N'%[_]TEST' OR tgt = src)
    THROW 50000, N'Refusing to run: every target database name must end in _TEST and differ from its source.', 1;

DECLARE @backupDir nvarchar(260) = CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(260));
DECLARE @dataDir   nvarchar(260) = CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(260));
IF RIGHT(@backupDir, 1) <> N'\' SET @backupDir += N'\';
IF RIGHT(@dataDir, 1) <> N'\' SET @dataDir += N'\';

DECLARE @src sysname, @tgt sysname, @bak nvarchar(400), @move nvarchar(max), @cmd nvarchar(max), @msg nvarchar(400);

DECLARE pair_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT src, tgt FROM @pairs;
OPEN pair_cursor;
FETCH NEXT FROM pair_cursor INTO @src, @tgt;

WHILE @@FETCH_STATUS = 0
BEGIN
    IF DB_ID(@src) IS NULL
    BEGIN
        SET @msg = N'Source database not found: ' + @src;
        THROW 50001, @msg, 1;
    END

    -- 1. Copy-only backup of the source (read-only for the source).
    SET @bak = @backupDir + @src + N'_portal_copy.bak';
    SET @cmd = N'BACKUP DATABASE ' + QUOTENAME(@src) + N' TO DISK = @bak WITH COPY_ONLY, INIT;';
    EXEC sp_executesql @cmd, N'@bak nvarchar(400)', @bak = @bak;

    -- 2. MOVE clauses from the source's logical file names, renamed after the target.
    SELECT @move = STRING_AGG(
        N'MOVE N''' + REPLACE(name, N'''', N'''''') + N''' TO N'''
        + REPLACE(@dataDir + @tgt + N'_' + CAST(file_id AS nvarchar(10))
                  + CASE WHEN type_desc = N'LOG' THEN N'.ldf' ELSE N'.mdf' END, N'''', N'''''')
        + N'''', N', ')
    FROM sys.master_files
    WHERE database_id = DB_ID(@src);

    -- 3. Drop connections to an existing copy so it can be replaced.
    IF DB_ID(@tgt) IS NOT NULL
    BEGIN
        SET @cmd = N'ALTER DATABASE ' + QUOTENAME(@tgt) + N' SET SINGLE_USER WITH ROLLBACK IMMEDIATE;';
        EXEC (@cmd);
    END

    -- 4. Restore the backup under the _TEST name.
    SET @cmd = N'RESTORE DATABASE ' + QUOTENAME(@tgt) + N' FROM DISK = @bak WITH REPLACE, RECOVERY, ' + @move + N';';
    EXEC sp_executesql @cmd, N'@bak nvarchar(400)', @bak = @bak;

    -- 5. Make sure the copy accepts normal connections.
    SET @cmd = N'ALTER DATABASE ' + QUOTENAME(@tgt) + N' SET MULTI_USER;';
    EXEC (@cmd);

    SET @msg = N'Restored ' + @src + N' -> ' + @tgt;
    PRINT @msg;

    FETCH NEXT FROM pair_cursor INTO @src, @tgt;
END

CLOSE pair_cursor;
DEALLOCATE pair_cursor;
