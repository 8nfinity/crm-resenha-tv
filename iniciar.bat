@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM  CRM WhatsApp - inicializador
REM
REM  Duplo clique aqui sobe as DUAS partes:
REM    1. Evolution API  (a ponte com o WhatsApp)  -> porta 8080
REM    2. CRM            (a interface)             -> porta 3000
REM
REM  O "cd /d %~dp0" e obrigatorio: sem ele, um duplo clique
REM  roda o script a partir de C:\Windows\System32.
REM ============================================================

cd /d "%~dp0"
title CRM WhatsApp

set "EVO_DIR=C:\Users\moyso\evolution-api"

echo.
echo   ============================================
echo     CRM WhatsApp
echo   ============================================
echo.

REM ---------- 1. Node.js instalado? ----------
where node >nul 2>nul
if errorlevel 1 (
    echo   [ERRO] Node.js nao encontrado.
    echo.
    echo   Instale a versao LTS em https://nodejs.org
    echo   Depois feche e abra este arquivo de novo.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo   Node.js !NODEVER!

REM ---------- 2. Arquivo .env ----------
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo   Criei o arquivo .env a partir do exemplo.
    ) else (
        echo   [ERRO] Nao achei .env nem .env.example.
        echo   Voce esta na pasta certa do projeto?
        echo.
        pause
        exit /b 1
    )
)

REM ---------- 3. Banco ainda com valor de exemplo? ----------
set BANCO_OK=1
findstr /C:"SEUPROJETO" ".env" >nul 2>nul
if not errorlevel 1 set BANCO_OK=0

if "!BANCO_OK!"=="0" (
    echo.
    echo   ------------------------------------------------
    echo    ATENCAO: o banco de dados ainda nao foi configurado.
    echo   ------------------------------------------------
    echo.
    echo    Abra o arquivo .env e preencha DATABASE_URL e
    echo    DIRECT_URL com os dados do seu projeto no Supabase.
    echo.
    pause
)

REM ---------- 4. Dependencias do CRM ----------
if not exist "node_modules" (
    echo.
    echo   Instalando dependencias do CRM. Demora alguns minutos
    echo   na primeira vez, principalmente dentro do OneDrive.
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo   [ERRO] A instalacao falhou. Veja as mensagens acima.
        echo.
        pause
        exit /b 1
    )
) else (
    echo   Dependencias do CRM ja instaladas.
)

REM ---------- 5. Cliente do Prisma ----------
if not exist "lib\generated\prisma" (
    echo   Gerando o cliente do banco...
    call npx prisma generate
    if errorlevel 1 (
        echo.
        echo   [ERRO] Falha ao gerar o cliente do Prisma.
        echo   Confira se DIRECT_URL esta preenchida no .env.
        echo.
        pause
        exit /b 1
    )
)

REM ---------- 6. Evolution API ----------
REM Ela e a ponte com o WhatsApp: sem ela o funil abre, mas fica
REM sem contatos e sem mensagens novas.
if not exist "%EVO_DIR%\package.json" (
    echo.
    echo   [aviso] Evolution API nao encontrada em:
    echo           %EVO_DIR%
    echo   O CRM vai subir, mas a tela Conexao nao vai funcionar.
    echo.
    goto :subir_crm
)

REM Ja esta rodando? Evita abrir uma segunda instancia, que brigaria
REM pela porta 8080 e pela sessao do WhatsApp.
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo   Evolution API ja esta rodando na porta 8080.
    goto :subir_crm
)

echo   Subindo a Evolution API numa janela separada...
start "Evolution API - WhatsApp" cmd /k "cd /d "%EVO_DIR%" && npm run start:prod"

REM Ela leva alguns segundos para aceitar conexoes. O CRM tolera
REM a ausencia dela, entao esta espera e so para o log ficar limpo.
echo   Aguardando a Evolution responder...
set EVO_OK=0
for /l %%i in (1,1,20) do (
    if !EVO_OK!==0 (
        timeout /t 2 /nobreak >nul
        netstat -ano | findstr ":8080" | findstr "LISTENING" >nul 2>nul
        if not errorlevel 1 set EVO_OK=1
    )
)
if !EVO_OK!==1 (
    echo   Evolution API no ar.
) else (
    echo   [aviso] A Evolution demorou a responder. Veja a outra janela.
)

:subir_crm

REM ---------- 7. A porta 3000 esta livre? ----------
REM Sem esta checagem, o `next start` morre com um EADDRINUSE e um rastro de
REM pilha do Node — que nao diz a ninguem que o problema e so uma instancia
REM anterior que ficou aberta.
REM O build ficou para tras do codigo? Decide se recompila aqui embaixo e se
REM uma instancia do CRM ja aberta pode ser aproveitada.
set PRECISA_BUILD=0
node scripts\build-desatualizado.mjs
if errorlevel 1 set PRECISA_BUILD=1

set PORTA_OCUPADA=0
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 set PORTA_OCUPADA=1

if "!PORTA_OCUPADA!"=="1" (
    REM Pode ser o proprio CRM ja rodando. Se o codigo nao mudou, basta abrir
    REM o navegador; se mudou, a instancia aberta serve a versao antiga e
    REM precisa ser trocada.
    curl -s -o nul -m 5 http://localhost:3000/hoje 2>nul
    if not errorlevel 1 (
        if "!PRECISA_BUILD!"=="0" (
            echo.
            echo   O CRM ja esta rodando nesta porta. Abrindo o navegador.
            echo.
            start "" http://localhost:3000
            timeout /t 3 /nobreak >nul
            exit /b 0
        )
        echo.
        echo   O CRM aberto esta com uma versao antiga. Reiniciando com o codigo novo.
        for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%p /F >nul 2>nul
        timeout /t 3 /nobreak >nul
        set PORTA_OCUPADA=0
    )
)

if "!PORTA_OCUPADA!"=="1" (

    echo.
    echo   ------------------------------------------------
    echo    A porta 3000 esta ocupada por outro programa.
    echo   ------------------------------------------------
    echo.
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do set PID_3000=%%p
    echo    Processo ocupando a porta: PID !PID_3000!
    echo.
    choice /C SN /N /M "   Encerrar esse processo e continuar? (S/N): "
    if errorlevel 2 (
        echo.
        echo   Cancelado. Feche o programa que usa a porta 3000 e tente de novo.
        echo.
        pause
        exit /b 1
    )
    taskkill /PID !PID_3000! /F >nul 2>nul
    timeout /t 3 /nobreak >nul
    echo   Porta liberada.
)

REM ---------- 8. Compilar ----------
REM Roda em modo producao, nao desenvolvimento. A diferenca e real: em dev o
REM Next recompila a cada navegacao, e cada troca de aba pagava por isso.
REM A compilacao leva ~1 min na primeira vez e so repete quando o codigo muda.
if "!PRECISA_BUILD!"=="1" (
    echo.
    echo   Compilando a versao mais recente. Leva cerca de um minuto.
    echo.
    call npm run build
    if errorlevel 1 (
        echo.
        echo   [ERRO] A compilacao falhou. Veja as mensagens acima.
        echo.
        pause
        exit /b 1
    )
) else (
    echo   Build ja existe, subindo direto.
)

echo.
echo   ============================================
echo     CRM em http://localhost:3000
echo.
echo     O navegador abre sozinho em alguns segundos.
echo     Para parar: feche esta janela ou aperte Ctrl+C.
echo     (a Evolution fica na outra janela)
echo   ============================================
echo.

start "" cmd /c "timeout /t 9 /nobreak >nul & start "" http://localhost:3000"

call npm run start

echo.
echo   O CRM foi encerrado.
echo.
pause
