@echo off
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org ^(LTS^), then run this again. & pause & exit /b)
start "" http://localhost:3000
node server\server.js
