@echo off
start "Global Awakening Server" cmd /k "color 0D && title Global Awakening Server && npx -y serve . -p 4321"
timeout /t 5 /nobreak > nul
start "" "http://localhost:4321/app.html"
