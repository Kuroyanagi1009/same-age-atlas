@echo off
rem Same-Age Atlas: start a local server and open the browser. Close this window to stop.
cd /d "%~dp0"
start "" http://127.0.0.1:8795/
python -m http.server 8795 --bind 127.0.0.1
