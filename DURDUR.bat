@echo off
REM SerInvest -- programi kapat. Cift tiklayin.
REM `stop` kullanilir, `down` DEGIL: `down` konteynerleri siler ve veritabani
REM gecmisi kaybolur. Kullanici "kapat" derken bunu kastetmez.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\kurulum.ps1" -Durdur
