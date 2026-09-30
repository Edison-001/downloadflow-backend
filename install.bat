@echo off
setlocal EnableExtensions EnableDelayedExpansion
title DownloadFlow - Installation automatique

cd /d "%~dp0"

echo.
echo ============================================================
echo                 DOWNLOADFLOW INSTALLER
echo ============================================================
echo.

REM ------------------------------------------------------------
REM 1. Verifier Node.js et npm
REM ------------------------------------------------------------
echo [1/6] Verification de Node.js...

where node >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js n'est pas installe.
    echo.
    echo Telecharge et installe Node.js LTS depuis :
    echo https://nodejs.org/
    echo Puis relance install.bat.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%V in ('node --version') do set "NODE_VERSION=%%V"
echo [OK] Node.js !NODE_VERSION!

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] npm est introuvable.
    echo Reinstalle Node.js LTS puis relance ce script.
    pause
    exit /b 1
)

for /f "delims=" %%V in ('npm --version') do set "NPM_VERSION=%%V"
echo [OK] npm !NPM_VERSION!
echo.

REM ------------------------------------------------------------
REM 2. Installer yt-dlp si absent
REM ------------------------------------------------------------
echo [2/6] Verification de yt-dlp...

where yt-dlp >nul 2>nul
if not errorlevel 1 (
    for /f "delims=" %%V in ('yt-dlp --version') do set "YTDLP_VERSION=%%V"
    echo [OK] yt-dlp !YTDLP_VERSION!
    goto :CHECK_FFMPEG
)

if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\yt-dlp.exe" (
    echo [OK] yt-dlp trouve via WinGet.
    goto :CHECK_FFMPEG
)

echo [INFO] yt-dlp est absent.

where winget >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] winget n'est pas disponible.
    echo Installe yt-dlp manuellement puis relance ce script.
    echo Documentation : https://github.com/yt-dlp/yt-dlp
    echo.
    pause
    exit /b 1
)

echo [INFO] Installation de yt-dlp avec WinGet...
winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements

if errorlevel 1 (
    echo [ERREUR] Impossible d'installer yt-dlp automatiquement.
    echo Installe-le manuellement puis relance ce script.
    pause
    exit /b 1
)

REM Actualiser le PATH dans cette session
set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Links"

where yt-dlp >nul 2>nul
if errorlevel 1 (
    echo [AVERTISSEMENT] yt-dlp a ete installe mais n'est pas encore visible.
    echo Ferme puis relance install.bat si necessaire.
) else (
    for /f "delims=" %%V in ('yt-dlp --version') do set "YTDLP_VERSION=%%V"
    echo [OK] yt-dlp !YTDLP_VERSION!
)

:CHECK_FFMPEG
echo.

REM ------------------------------------------------------------
REM 3. Installer FFmpeg si absent
REM ------------------------------------------------------------
echo [3/6] Verification de FFmpeg...

where ffmpeg >nul 2>nul
if not errorlevel 1 (
    for /f "tokens=1" %%V in ('ffmpeg -version 2^>nul') do set "FFMPEG_VERSION=%%V"
    echo [OK] FFmpeg detecte : !FFMPEG_VERSION!
    goto :INSTALL_NPM
)

echo [INFO] FFmpeg est absent.

where winget >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] winget n'est pas disponible.
    echo Installe FFmpeg manuellement puis relance ce script.
    echo.
    pause
    exit /b 1
)

echo [INFO] Installation de FFmpeg avec WinGet...
winget install --id Gyan.FFmpeg.Shared -e --accept-source-agreements --accept-package-agreements

if errorlevel 1 (
    echo [AVERTISSEMENT] Installation de FFmpeg.Shared echouee.
    echo Tentative avec Gyan.FFmpeg...
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
)

REM Actualiser le PATH courant avec les chemins WinGet classiques
set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Links"

where ffmpeg >nul 2>nul
if errorlevel 1 (
    echo [AVERTISSEMENT] FFmpeg vient peut-etre d'etre installe.
    echo Windows peut necessiter un nouveau terminal pour actualiser PATH.
    echo.
) else (
    echo [OK] FFmpeg est disponible.
)

:INSTALL_NPM
echo.

REM ------------------------------------------------------------
REM 4. Installer les dependances Node
REM ------------------------------------------------------------
echo [4/6] Installation des dependances DownloadFlow...

if not exist "package.json" (
    echo [ERREUR] package.json introuvable.
    echo Place install.bat a la racine du projet DownloadFlow.
    pause
    exit /b 1
)

call npm install
if errorlevel 1 (
    echo.
    echo [ERREUR] npm install a echoue.
    pause
    exit /b 1
)

echo [OK] Dependances Node installees.
echo.

REM ------------------------------------------------------------
REM 5. Verifications finales
REM ------------------------------------------------------------
echo [5/6] Verification finale...

set "ALL_OK=1"

where node >nul 2>nul
if errorlevel 1 set "ALL_OK=0"

where npm >nul 2>nul
if errorlevel 1 set "ALL_OK=0"

where yt-dlp >nul 2>nul
if errorlevel 1 set "ALL_OK=0"

where ffmpeg >nul 2>nul
if errorlevel 1 set "ALL_OK=0"

if "!ALL_OK!"=="0" (
    echo.
    echo [ATTENTION] Certains outils ne sont pas encore visibles
    echo dans ce terminal.
    echo.
    echo Ferme cette fenetre, ouvre un nouveau PowerShell/CMD,
    echo puis relance install.bat.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js
echo [OK] npm
echo [OK] yt-dlp
echo [OK] FFmpeg
echo [OK] Dependances DownloadFlow

echo.
echo ============================================================
echo                    INSTALLATION TERMINEE
echo ============================================================
echo.
echo DownloadFlow est pret.
echo.
echo Pour demarrer le serveur :
echo     npm start
echo.
echo Puis ouvre :
echo     http://localhost:3000
echo.

choice /C ON /N /M "Demarrer DownloadFlow maintenant ? [O/N] : "
if errorlevel 2 goto :END
if errorlevel 1 goto :START

:START
echo.
echo [6/6] Demarrage du serveur...
echo.
call npm start
goto :END

:END
echo.
echo Fin.
pause
endlocal
