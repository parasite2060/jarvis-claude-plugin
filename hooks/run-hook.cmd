: << 'CMDBLOCK'
@echo off
REM Cross-platform polyglot wrapper for Jarvis hook scripts.
REM On Windows: cmd.exe runs the batch portion, calls node directly.
REM On Unix: the shell interprets this as a script (: is a no-op in bash).

if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)

set "HOOK_DIR=%~dp0"
node "%HOOK_DIR%%~1.js" %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
CMDBLOCK

# Unix: run node directly
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
shift
exec node "${SCRIPT_DIR}/${SCRIPT_NAME}.js" "$@"
