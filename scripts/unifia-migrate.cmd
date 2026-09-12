@echo off
REM unifia-migrate.cmd — Migration automatique opencode → unifia (Windows)
REM Usage: scripts\unifia-migrate.cmd [--dry-run|--apply]
REM
REM Equivalent Windows de unifia-migrate.sh pour les utilisateurs
REM qui ne peuvent pas exécuter bash sur Windows.
REM
REM Auteur: Hermes Agent (MiniMax M3) pour Unifia Workbench V3
REM Date: 2026-07-31

setlocal EnableDelayedExpansion

REM === Par défaut mode ===
set MODE=dry-run
if /i "%1"=="--apply" set MODE=apply
if /i "%1"=="--dry-run" set MODE=dry-run

REM === Couleurs (si terminal moderne) ===
for /F "tokens=*" %%i in ('echo prompt $E ^| cmd') do set "ESC=%%i"
set GREEN=%ESC%[0;32m
set YELLOW=%ESC%[1;33m
set RED=%ESC%[0;31m
set NC=%ESC%[0m

REM === Détection Windows : chemins typiques ===
set HOME_DIR=%USERPROFILE%
set APPDATA_DIR=%APPDATA%
set LOCALAPPDATA_DIR=%LOCALAPPDATA%

REM Unifia stocke ses données dans %APPDATA%\unifia (XDG_DATA_HOME equivalent)
set NEW_DIR=%APPDATA_DIR%\unifia
set LEGACY_DIR=%APPDATA_DIR%\opencode

echo ============================================
echo Unifia migration tool (Windows)
echo ============================================
echo Mode: %MODE%
echo Legacy dir: %LEGACY_DIR%
echo New dir:    %NEW_DIR%
echo ============================================
echo.

REM === Check legacy dir ===
if not exist "%LEGACY_DIR%" (
    echo [INFO] Aucun legacy dir trouve: %LEGACY_DIR%
    echo [INFO] Normal si c'est une fresh install.
    goto :eof
)

echo [INFO] Legacy dir trouve: %LEGACY_DIR%
echo.

REM === Migration DB ===
if exist "%LEGACY_DIR%\opencode.db" (
    if exist "%NEW_DIR%\unifia.db" (
        echo [INFO] DB deja migree: %NEW_DIR%\unifia.db
    ) else (
        echo [%YELLOW%APPLY%NC%] Renommer %LEGACY_DIR%\opencode.db -^> %NEW_DIR%\unifia.db
        if /i "%MODE%"=="apply" (
            if not exist "%NEW_DIR%" mkdir "%NEW_DIR%"
            move "%LEGACY_DIR%\opencode.db" "%NEW_DIR%\unifia.db"
            if errorlevel 1 (
                echo [%RED%FAIL%NC%] Echec de la migration de la DB
            ) else (
                echo [%GREEN%OK%NC%]   DB migree
            )
        )
    )
)

REM === Migration config ===
if exist "%LEGACY_DIR%\opencode.jsonc" (
    if exist "%NEW_DIR%\unifia.jsonc" (
        echo [INFO] Config deja migree: %NEW_DIR%\unifia.jsonc
    ) else (
        echo [%YELLOW%APPLY%NC%] Renommer %LEGACY_DIR%\opencode.jsonc -^> %NEW_DIR%\unifia.jsonc
        if /i "%MODE%"=="apply" (
            if not exist "%NEW_DIR%" mkdir "%NEW_DIR%"
            move "%LEGACY_DIR%\opencode.jsonc" "%NEW_DIR%\unifia.jsonc"
            if errorlevel 1 (
                echo [%RED%FAIL%NC%] Echec de la migration de la config
            ) else (
                echo [%GREEN%OK%NC%]   Config migree
            )
        )
    )
)

REM === Migration cache dir ===
if exist "%LOCALAPPDATA_DIR%\opencode" (
    if exist "%LOCALAPPDATA_DIR%\unifia" (
        echo [INFO] Cache dir deja migre: %LOCALAPPDATA_DIR%\unifia
    ) else (
        echo [%YELLOW%APPLY%NC%] Renommer %LOCALAPPDATA_DIR%\opencode -^> %LOCALAPPDATA_DIR%\unifia
        if /i "%MODE%"=="apply" (
            move "%LOCALAPPDATA_DIR%\opencode" "%LOCALAPPDATA_DIR%\unifia"
            if errorlevel 1 (
                echo [%RED%FAIL%NC%] Echec de la migration du cache
            ) else (
                echo [%GREEN%OK%NC%]   Cache migre
            )
        )
    )
)

echo.
echo ============================================
if /i "%MODE%"=="apply" (
    echo [%GREEN%OK%NC%] Migration terminee. Redemarrez l'app Unifia.
) else (
    echo [INFO] Mode dry-run. Utilisez --apply pour migrer.
)
echo ============================================

endlocal
