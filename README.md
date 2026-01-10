Project: Telegram TTS Bot with ElevenLabs and Web Admin Panel

Setup
- Install Node.js 18+
- Copy .env.example to .env and fill BOT_TOKEN, ELEVENLABS_API_KEY, ADMIN_PASSWORD, ADMIN_TELEGRAM_ID, PORT, BASE_URL, PAYMENT_INSTRUCTIONS
- Ensure you have a MySQL database. Set MYSQL_URL in .env.
- Run: npm install
- Start: npm start

Features
- Telegram bot with permanent keyboard: Plans, Models, Profile, Contact
- Inline voice selection and plan purchase
- Manual payment by screenshot with admin notification and approval
- Credit system: 1 generation = 1 credit
- Web admin panel to manage users, payments, voices, plans, settings
- Audio/Video conversion:
  - Forwards audio/voice messages as voice messages.
  - Converts videos <15MB to Video Notes (rounded) automatically.

Admin Panel
- URL: http://localhost:8080/admin (or your deployed URL)
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
- Send Audio/Voice to get it echoed as a Voice Message
- Send Video (<15MB) to get it converted to a Video Note

Storage & Database
- Database: MySQL (Required). Set MYSQL_URL.
- Uploads: Payment screenshots are stored in `uploads/`.
  - NOTE: On ephemeral hosting like Railway (without persistent volume), these files will be lost on redeploy/restart.
  - Admin test audio is also temporarily saved here.
  - User generated TTS audio is streamed directly to Telegram and not stored.

Railway Deploy
1. Push to GitHub
2. Create Railway project from the repo
3. Add a MySQL Database service in Railway.
4. Connect the repository to the Railway project.
5. Set env vars (see .env.example) including:
   - BOT_TOKEN
   - ELEVENLABS_API_KEY
   - ADMIN_PASSWORD
   - ADMIN_TELEGRAM_ID
   - BASE_URL (Your Railway App URL, e.g. https://xxx.up.railway.app)
   - MYSQL_URL (Railway usually sets this automatically if you link the DB, or copy from DB service)
6. Start command: `npm start` (Auto-detected via railway.json/Procfile)

Git Quick Start
```bash
git init
git add .
git commit -m "Initial deploy"
git branch -M main
git remote add origin <YOUR_REPO_URL>
git push -u origin main
```
