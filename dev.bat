@echo off
REM Smash Pairing - local dev launcher
REM
REM Serves the app at http://localhost:8787 using a simple static HTTP server.
REM Any saves you make are hitting your REAL Supabase project, so changes you
REM make here show up on your phone (and vice versa) after a page refresh.
REM
REM Why `serve` instead of `wrangler dev`: this repo lives under OneDrive, and
REM OneDrive constantly touches files in the background. Wrangler watches the
REM whole asset directory and reloads on every touch, which puts it in an
REM infinite reload loop. `serve` just serves files - no watcher, no loop.
REM
REM First run: npx downloads the `serve` package (~5MB, one time, cached after).
REM
REM Stop the server: Ctrl+C in this window.
REM Refresh after edits: hard-refresh in the browser (Ctrl+Shift+R) to bypass
REM the service worker cache.

setlocal
cd /d "%~dp0"

echo.
echo === Smash Pairing dev server ===
echo.
echo Local URL:  http://localhost:8787
echo Database:   LIVE Supabase (changes persist)
echo.
echo Edit files, then HARD-refresh the browser (Ctrl+Shift+R).
echo Press Ctrl+C to stop.
echo.

REM Open the browser after a short delay so the server has time to bind.
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8787"

npx --yes serve@latest -l 8787 -s .

endlocal
