@echo off
REM SerInvest -- ilk kurulum. Cift tiklayin.
REM Butun is scripts\kurulum.ps1 icinde; bu dosya yalnizca onu cagirir.
REM -ExecutionPolicy Bypass sart: Windows varsayilan olarak betik calistirmayi
REM engeller ve teknik olmayan kullanici bunu asamaz.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\kurulum.ps1" -Kur
