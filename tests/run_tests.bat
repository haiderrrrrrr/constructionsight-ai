@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  ConstructionSight-AI  —  Enterprise Test Suite Runner
::  One combined run → one Allure report → PDFs auto-opened
:: ============================================================

set ROOT=H:\ConstructionSight-AI
set BACKEND=%ROOT%\backend
set VENV=%BACKEND%\.venv
set PYTHON=%VENV%\Scripts\python.exe
set ALLURE=allure

set RESULTS=%ROOT%\tests\accessories\reports\allure-results
set REPORT=%ROOT%\tests\accessories\reports\allure-report
set COVERAGE=%ROOT%\tests\accessories\reports\coverage
set PDF_DIR=%ROOT%\tests\accessories\reports\pdf
set CATEGORIES=%ROOT%\tests\accessories\categories.json

:: Detect which marker filter to apply (default = all)
set SUITE=%1
if "%SUITE%"=="" set SUITE=all

:: ============================================================
title ConstructionSight-AI Test Runner — %SUITE%
color 0A

echo.
echo  ============================================================
echo   ConstructionSight-AI  —  Enterprise Test Suite Runner
echo   Suite  : %SUITE%
echo  ============================================================
echo.

:: ============================================================
::  STEP 1  —  Preserve history, then clear stale results
:: ============================================================
echo [1/5] Clearing stale results (preserving trend history)...

:: Save history before wipe
if exist "%REPORT%\history" (
    if not exist "%TEMP%\allure-history-backup" mkdir "%TEMP%\allure-history-backup"
    xcopy /E /I /Y /Q "%REPORT%\history" "%TEMP%\allure-history-backup" >nul
    echo       History backed up.
)

:: Wipe results so no stale data from previous partial runs pollutes the report
if exist "%RESULTS%" (
    rmdir /s /q "%RESULTS%"
)
mkdir "%RESULTS%"

:: Restore history into fresh results
if exist "%TEMP%\allure-history-backup" (
    xcopy /E /I /Y /Q "%TEMP%\allure-history-backup" "%RESULTS%\history" >nul
    rmdir /s /q "%TEMP%\allure-history-backup"
    echo       History restored.
) else (
    echo       No previous history — first run.
)

:: Ensure other dirs exist
if not exist "%COVERAGE%"  mkdir "%COVERAGE%"
if not exist "%PDF_DIR%"   mkdir "%PDF_DIR%"
echo       Done.

:: ============================================================
::  STEP 2  —  Run tests (always one combined command)
:: ============================================================
echo.
echo [2/5] Running tests  [filter = %SUITE%]...
echo.
cd /d "%BACKEND%"

:: Build the marker expression for partial runs
set MARKER_ARGS=
if not "%SUITE%"=="all" (
    set MARKER_ARGS=-m %SUITE%
)

if "%SUITE%"=="all" (
    %PYTHON% -m pytest ..\tests\ ^
        --ignore=..\tests\load ^
        -v --tb=short ^
        --alluredir="%RESULTS%" ^
        --cov=app ^
        --cov-config=..\.coveragerc ^
        --cov-report=html:"%COVERAGE%" ^
        --cov-report=term-missing ^
        --timeout=60
) else (
    %PYTHON% -m pytest ..\tests\ ^
        --ignore=..\tests\load ^
        -m %SUITE% ^
        -v --tb=short ^
        --alluredir="%RESULTS%" ^
        --timeout=60
)

set EXIT_CODE=%ERRORLEVEL%
:: Exit code 2 = coverage threshold not met (tests still ran) — treat as soft fail
if %EXIT_CODE% EQU 2 set EXIT_CODE=1

:: ============================================================
::  STEP 3  —  Write Allure environment + executor metadata
:: ============================================================
echo.
echo [3/5] Writing Allure metadata...

for /f "tokens=*" %%i in ('hostname') do set MACHINE=%%i
for /f "tokens=*" %%v in ('%PYTHON% --version 2^>^&1') do set PYVER=%%v

(
    echo Project=ConstructionSight-AI
    echo Suite=%SUITE%
    echo Environment=Test
    echo Database=constructionsight_test (PostgreSQL 16)
    echo Framework=FastAPI 0.115.0
    echo Auth=JWT + Argon2 + httponly refresh cookies
    echo Python=%PYVER%
    echo Machine=%MACHINE%
    echo Coverage.Report=%COVERAGE%
    echo PDF.Reports=%PDF_DIR%
) > "%RESULTS%\environment.properties"

if exist "%CATEGORIES%" (
    copy /Y "%CATEGORIES%" "%RESULTS%\categories.json" >nul
)

(
    echo {
    echo   "name": "%MACHINE%",
    echo   "type": "local",
    echo   "buildName": "ConstructionSight-AI — %SUITE%",
    echo   "reportName": "ConstructionSight-AI — Combined Test Report"
    echo }
) > "%RESULTS%\executor.json"

echo       Done.

:: ============================================================
::  STEP 4  —  Generate single combined Allure report
:: ============================================================
echo.
echo [4/5] Generating Allure report...
%ALLURE% generate "%RESULTS%" -o "%REPORT%" --clean
if %ERRORLEVEL% EQU 0 (
    echo       Report generated: %REPORT%\index.html
) else (
    echo       [WARN] allure generate failed — run: scoop install allure
)

:: ============================================================
::  STEP 5  —  Open everything
:: ============================================================
echo.
echo [5/5] Opening reports...

if exist "%REPORT%\index.html" (
    start "" "%REPORT%\index.html"
    echo       Allure dashboard opened.
)

if exist "%COVERAGE%\index.html" (
    start "" "%COVERAGE%\index.html"
    echo       Coverage report opened.
)

for %%f in ("%PDF_DIR%\*.pdf") do (
    start "" "%%f"
    echo       PDF opened: %%~nxf
)
for %%f in ("%PDF_DIR%\*.txt") do (
    start "" "%%f"
    echo       TXT opened: %%~nxf
)

:: ============================================================
echo.
echo  ============================================================
echo   Reports Summary
echo  ============================================================
echo   Allure   : %REPORT%\index.html
echo   Coverage : %COVERAGE%\index.html
echo   Reports  :
for %%f in ("%PDF_DIR%\*.pdf") do echo     - %%~nxf
for %%f in ("%PDF_DIR%\*.txt") do echo     - %%~nxf
echo  ============================================================

if %EXIT_CODE% NEQ 0 (
    echo  [RESULT] Some tests FAILED  (exit code: %EXIT_CODE%)
    color 0C
) else (
    echo  [RESULT] All tests PASSED
    color 0A
)

echo.
endlocal
exit /b %EXIT_CODE%
