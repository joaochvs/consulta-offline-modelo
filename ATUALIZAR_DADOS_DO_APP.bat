@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Arraste a base COMPLETA XLSX ou CSV sobre este arquivo.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Siga primeiro docs\01-INICIAR-PROJETO.md para instalar o ambiente.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" pipeline\atualizar.py "%~1"
set "RESULTADO=%ERRORLEVEL%"
echo.
echo Esta rotina apenas gera e valida a base local. Publicacao e uma etapa separada.
pause
exit /b %RESULTADO%
