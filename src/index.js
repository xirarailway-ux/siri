const fs = require('fs')
const path = require('path')
const { startServer } = require('./server')
const { port, botToken, baseUrl } = require('./config')
const db = require('./db')
fs.mkdirSync(path.join(__dirname, '..', 'uploads', 'payments'), { recursive: true })
startServer()
let bot
if (botToken) {
  bot = require('./bot').bot
  const useWebhook = !!baseUrl && /^https?:\/\//i.test(baseUrl)
  if (!useWebhook) {
    bot.launch()
    process.once('SIGINT', () => bot.stop('SIGINT'))
    process.once('SIGTERM', () => bot.stop('SIGTERM'))
  }
  setInterval(async () => {
    const users = await db.listUsers()
    for (const u of users) {
      if ((u.credits||0) > 0 && u.credit_expires_at && new Date(u.credit_expires_at).getTime() < Date.now()) {
        await db.enforceExpiryByTg(u.tg_id)
        try { await bot.telegram.sendMessage(u.tg_id, 'Your plan has expired. Credits reset to 0.') } catch (_) {}
      }
      if ((u.credits||0) > 0) {
        const last = u.last_generation_at ? new Date(u.last_generation_at).getTime() : 0
        if (Date.now() - last > 5*24*3600*1000) {
          try { await bot.telegram.sendMessage(u.tg_id, 'You have unused voice credits. Generate now!') } catch (_) {}
        }
      }
    }
  }, 24*3600*1000)
} else {
  console.warn('BOT_TOKEN missing. Running admin panel only.')
}
 
