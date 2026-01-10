const dotenv = require('dotenv')
dotenv.config()
module.exports = {
  botToken: process.env.BOT_TOKEN || '',
  elevenApiKey: process.env.ELEVENLABS_API_KEY || '',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  adminTelegramId: process.env.ADMIN_TELEGRAM_ID || '',
  port: parseInt(process.env.PORT || '8080', 10),
  baseUrl: process.env.BASE_URL || '',
  databaseUrl: process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL || '',
  paymentInstructions: process.env.PAYMENT_INSTRUCTIONS || 'Upload payment screenshot after paying.'
}
