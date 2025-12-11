Project: Telegram TTS Bot with ElevenLabs and Web Admin Panel

Setup
- Install Node.js 18+
- Copy .env.example to .env and fill BOT_TOKEN, ELEVENLABS_API_KEY, ADMIN_PASSWORD, ADMIN_TELEGRAM_ID, PORT, BASE_URL, PAYMENT_INSTRUCTIONS
- Run: npm install
- Start: npm start

Features
- Telegram bot with permanent keyboard: Plans, Models, Profile, Contact
- Inline voice selection and plan purchase
- Manual payment by screenshot with admin notification and approval
- Credit system: 1 generation = 1 credit
- Web admin panel to manage users, payments, voices, plans, settings

Admin Panel
- URL: http://localhost:3000/admin (Railway sets your domain; use BASE_URL)
- Login with ADMIN_PASSWORD from .env (hashed and stored on first login)
- Manage voices: sync from ElevenLabs, enable/disable
- Manage plans: create, activate/deactivate
- Manage users: add credits, block/unblock
- Payments: approve/reject with screenshot preview
- Settings: payment instructions and contact info

Bot Use
- /start shows keyboard
- Models to choose voice
- Send text to get MP3 audio
- Plans to select plan and submit screenshot

Storage
- JSON DB file: data/file.db
- Uploads: uploads/payments; audio responses are streamed back to Telegram and NOT stored on server

Notes
- Do not store secrets in the repository; use .env
- Ensure ADMIN_TELEGRAM_ID is set to receive payment notifications
- Health endpoint: GET /health → 200 OK
- Hacker theme is enforced across admin
- Broadcast section allows sending text, photo, audio, document combinations

Railway Deploy
1. Push to GitHub
2. Create Railway project from the repo
3. Set env vars (see .env.example) including BOT_TOKEN, ELEVENLABS_API_KEY, ADMIN_PASSWORD, ADMIN_TELEGRAM_ID, BASE_URL, PAYMENT_INSTRUCTIONS
4. Port is injected by Railway; default is 8080
5. Start command: npm start or Procfile web process

Git Quick Start
```
git init
git add .
git commit -m "Initial deploy"
git branch -M main
git remote add origin https://github.com/xirarailway-ux/heysiri.git
# push with PAT: https://<USERNAME>:<TOKEN>@github.com/xirarailway-ux/heysiri.git
git push -u origin main
```
