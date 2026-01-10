const express = require('express')
const session = require('express-session')
const path = require('path')
const bcrypt = require('bcryptjs')
const bodyParser = require('body-parser')
const fs = require('fs')
const { port, adminPassword, botToken, baseUrl, adminTelegramId } = require('./config')
const db = require('./db')
const eleven = require('./elevenlabs')
const multer = require('multer')
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'products') })
const uploadQr = multer({ dest: path.join(__dirname, '..', 'uploads', 'qr') })
const uploadBc = multer({ dest: path.join(__dirname, '..', 'uploads', 'broadcast') })
const uploadBackup = multer({ dest: path.join(__dirname, '..', 'uploads', 'tmp') })
const archiver = require('archiver')
const extract = require('extract-zip')
let bot = null
if (botToken) { try { bot = require('./bot').bot } catch (_) {} }
const app = express()
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.use('/public', express.static(path.join(__dirname, '..', 'public')))
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))
app.use(express.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(session({ secret: 'tts_admin_secret', resave: false, saveUninitialized: false }))
if (bot && baseUrl) {
  try {
    app.get('/bot/webhook', (req, res) => res.status(200).send('OK'))
    app.post('/bot/webhook', bot.webhookCallback('/bot/webhook'))
    bot.telegram.setWebhook(`${baseUrl}/bot/webhook`)
    console.log('Webhook set:', `${baseUrl}/bot/webhook`)
  } catch (_) {}
}
async function ensureAdminHashSync() {
  try {
    let hash = await db.getSetting('admin_hash')
    if (!hash) {
      const newHash = bcrypt.hashSync(adminPassword, 10)
      await db.setSetting('admin_hash', newHash)
      return
    }
    const matchesEnv = bcrypt.compareSync(adminPassword, hash)
    if (!matchesEnv) {
      const newHash = bcrypt.hashSync(adminPassword, 10)
      await db.setSetting('admin_hash', newHash)
    }
  } catch (_) {}
}
app.get('/', (req, res) => res.redirect('/admin'))
function ensureAdmin(req, res, next) { if (req.session && req.session.admin) return next(); res.redirect('/admin/login') }
app.get('/admin/login', (req, res) => { res.render('login', { error: null }) })
app.post('/admin/login', async (req, res) => {
  const pass = req.body.password || ''
  let hash = await db.getSetting('admin_hash')
  if (!hash) { hash = bcrypt.hashSync(adminPassword, 10); await db.setSetting('admin_hash', hash) }
  const ok = bcrypt.compareSync(pass, hash)
  if (!ok) return res.render('login', { error: 'Invalid password' })
  req.session.admin = true
  res.redirect('/admin')
})
app.get('/admin/logout', (req, res) => { req.session.destroy(() => res.redirect('/admin/login')) })
app.get('/health', (req, res) => res.status(200).send('OK'))
app.get('/admin', ensureAdmin, async (req, res) => { const s = await db.stats(); const pend = await db.pendingPayments(); res.render('dashboard', { stats: s, pending: pend, nav: 'dashboard' }) })
app.get('/admin/users', ensureAdmin, async (req, res) => { const rows = await db.listUsers(); res.render('users', { users: rows, nav: 'users' }) })
app.get('/admin/users/:tgid', ensureAdmin, async (req, res) => {
  const tgid = req.params.tgid
  const user = await db.getUserByTgId(tgid)
  if (!user) { res.redirect('/admin/users'); return }
  const payments = await db.listPaymentsByUserTg(tgid)
  const generations = await db.listGenerationsByUserTg(tgid)
  res.render('user', { user, payments, generations, nav: 'users' })
})
app.post('/admin/users/block', ensureAdmin, async (req, res) => { const id = req.body.id; await db.setUserBlockedByTg(id, true); if (bot) { try { await bot.telegram.sendMessage(id, 'Your access has been blocked by admin.') } catch (_) {} } res.redirect('/admin/users') })
app.post('/admin/users/unblock', ensureAdmin, async (req, res) => { const id = req.body.id; await db.setUserBlockedByTg(id, false); if (bot) { try { await bot.telegram.sendMessage(id, 'Your access has been restored.') } catch (_) {} } res.redirect('/admin/users') })
app.post('/admin/users/add-credits', ensureAdmin, async (req, res) => { const id = req.body.id; const amount = parseInt(req.body.amount, 10); const validDays = parseInt(req.body.valid_days || '0', 10); await db.addCreditsByTg(id, amount, validDays); if (bot) { try { const u = await db.getUserByTgId(id); await bot.telegram.sendMessage(id, `Credits added: +${amount}${validDays?`, valid for ${validDays} days`:''}. Total: ${u ? u.credits : ''}`) } catch (_) {} } res.redirect('/admin/users') })
app.post('/admin/users/remove-credits', ensureAdmin, async (req, res) => { const id = req.body.id; const amount = parseInt(req.body.amount, 10); await db.removeCreditsByTg(id, amount); if (bot) { try { const u = await db.getUserByTgId(id); await bot.telegram.sendMessage(id, `Credits removed: -${amount}. Total: ${u ? u.credits : ''}`) } catch (_) {} } res.redirect('/admin/users') })
app.get('/admin/payments', ensureAdmin, async (req, res) => { const rows = await db.allPayments(); res.render('payments', { payments: rows, nav: 'payments' }) })
app.post('/admin/payments/approve', ensureAdmin, async (req, res) => {
  const id = req.body.id
  const p = await db.getPaymentById(id)
  if (p && p.status === 'pending') {
    const plan = await db.getPlanById(p.plan_id)
    await db.updatePaymentStatus(id, 'approved', 0)
    await db.addCredits(p.user_id, plan.credits, plan.valid_days)
    const u = await db.getUserById(p.user_id)
    if (bot && u && u.tg_id) {
      const refreshed = await db.getUserById(p.user_id)
      const msg = `Payment approved for ${plan.name}. Credits added: ${plan.credits}. Total credits: ${refreshed.credits}`
      try { await bot.telegram.sendMessage(u.tg_id, msg) } catch (_) {}
    }
  }
  res.redirect('/admin/payments')
})
app.post('/admin/payments/reject', ensureAdmin, async (req, res) => {
  const id = req.body.id
  const p = await db.getPaymentById(id)
  if (p && p.status === 'pending') {
    await db.updatePaymentStatus(id, 'rejected', 0)
    const u = await db.getUserById(p.user_id)
    if (bot && u && u.tg_id) {
      try { await bot.telegram.sendMessage(u.tg_id, 'Payment rejected. Contact support if you need help.') } catch (_) {}
    }
  }
  res.redirect('/admin/payments')
})
app.get('/admin/voices', ensureAdmin, async (req, res) => { const rows = await db.listVoices(false); const error = req.query.error || null; res.render('voices', { voices: rows, nav: 'voices', error }) })
app.post('/admin/voices/sync', ensureAdmin, async (req, res) => {
  try { const apiVoices = await eleven.listVoices(); await db.setVoices(apiVoices); res.redirect('/admin/voices') }
  catch (e) { const msg = (e.response && e.response.data && e.response.data.message) ? e.response.data.message : (e.message || 'Sync failed'); res.redirect('/admin/voices?error=' + encodeURIComponent(msg)) }
})
app.post('/admin/voices/toggle', ensureAdmin, async (req, res) => { const id = req.body.voice_id; const enabled = req.body.enabled === '1'; await db.setVoiceEnabled(id, enabled); res.redirect('/admin/voices') })
app.post('/admin/voices/add', ensureAdmin, async (req, res) => { const { voice_id, name } = req.body; if (voice_id && name) await db.addVoice(voice_id, name); res.redirect('/admin/voices') })
app.post('/admin/voices/remove', ensureAdmin, async (req, res) => { const { voice_id } = req.body; if (voice_id) await db.removeVoice(voice_id); res.redirect('/admin/voices') })
app.get('/admin/plans', ensureAdmin, async (req, res) => { const rows = await db.listPlans(false); res.render('plans', { plans: rows, nav: 'plans' }) })
app.post('/admin/plans/create', ensureAdmin, async (req, res) => { await db.createPlan(req.body.name, parseInt(req.body.credits, 10), req.body.price, parseInt(req.body.valid_days || '0', 10)); res.redirect('/admin/plans') })
app.post('/admin/plans/toggle', ensureAdmin, async (req, res) => { await db.setPlanActive(req.body.id, req.body.active === '1'); res.redirect('/admin/plans') })
app.post('/admin/plans/delete', ensureAdmin, async (req, res) => { await db.deletePlan(req.body.id); res.redirect('/admin/plans') })
app.get('/admin/settings', ensureAdmin, async (req, res) => {
  const payment_instructions = await db.getSetting('payment_instructions') || ''
  const contact = await db.getSetting('contact') || ''
  const welcome_message = await db.getSetting('welcome_message') || 'Welcome to Hey Siri TTS Bot'
  const help_text = await db.getSetting('help_text') || ''
  const eleven_api_key = await db.getSetting('eleven_api_key') || ''
  const tts_model_id = await db.getSetting('tts_model_id') || 'eleven_v3'
  const tts_output_format = await db.getSetting('tts_output_format') || 'opus_48000_64'
  const tts_style = await db.getSetting('tts_style') || '0'
  const tts_stability = await db.getSetting('tts_stability') || '0.5'
  const tts_similarity_boost = await db.getSetting('tts_similarity_boost') || '0.5'
  const tts_use_speaker_boost = await db.getSetting('tts_use_speaker_boost') || '1'
  const pm = await db.getPaymentMethods()
  const pm_qr = await db.getPaymentQRCodes()
  const bdt_per_usd = await db.getSetting('bdt_per_usd') || '120'
  const welcome_photo = await db.getSetting('welcome_photo') || ''
  const welcome_audio = await db.getSetting('welcome_audio') || ''
  const welcome_document = await db.getSetting('welcome_document') || ''
  const max_text_length = await db.getSetting('max_text_length') || '125'
  let bot_me = null, webhook_info = null
  if (bot) {
    try { bot_me = await bot.telegram.getMe() } catch (_) {}
    try { webhook_info = await bot.telegram.getWebhookInfo() } catch (_) {}
  }
  const test_ok = (req.query.test_ok === '1') ? true : false
  const test_error = req.query.test_error ? req.query.test_error : null
  const import_ok = (req.query.import_ok === '1') ? true : false
  const import_error = req.query.import_error ? req.query.import_error : null
  res.render('settings', { payment_instructions, contact, welcome_message, help_text, welcome_photo, welcome_audio, welcome_document, eleven_api_key, tts_model_id, tts_output_format, tts_style, tts_stability, tts_similarity_boost, tts_use_speaker_boost, pm, pm_qr, bdt_per_usd, max_text_length, bot_me, webhook_info, nav: 'settings', test_ok, test_error, import_ok, import_error })
})
app.post('/admin/settings', ensureAdmin, uploadQr.fields([
  { name: 'qr_nagad', maxCount: 1 },
  { name: 'qr_btc', maxCount: 1 },
  { name: 'qr_ltc', maxCount: 1 },
  { name: 'qr_usdt', maxCount: 1 },
  { name: 'qr_binance', maxCount: 1 },
  { name: 'qr_eth', maxCount: 1 },
  { name: 'welcome_photo', maxCount: 1 },
  { name: 'welcome_audio', maxCount: 1 },
  { name: 'welcome_document', maxCount: 1 },
]), async (req, res) => {
  await db.setSetting('payment_instructions', (req.body.payment_instructions || '').trim())
  await db.setSetting('contact', (req.body.contact || '').trim())
  await db.setSetting('welcome_message', (req.body.welcome_message || '').trim())
  await db.setSetting('help_text', (req.body.help_text || '').trim())
  await db.setSetting('eleven_api_key', (req.body.eleven_api_key || '').trim())
  await db.setSetting('tts_model_id', req.body.tts_model_id || 'eleven_v3')
  await db.setSetting('tts_output_format', req.body.tts_output_format || 'opus_48000_64')
  await db.setSetting('tts_style', req.body.tts_style || '0')
  await db.setSetting('tts_stability', req.body.tts_stability || '0.5')
  await db.setSetting('tts_similarity_boost', req.body.tts_similarity_boost || '0.5')
  await db.setSetting('tts_use_speaker_boost', req.body.tts_use_speaker_boost ? '1' : '0')
  await db.setPaymentMethods({ nagad: req.body.nagad || '', btc: req.body.btc || '', ltc: req.body.ltc || '', usdt: req.body.usdt || '', binance_id: req.body.binance_id || '', eth: req.body.eth || '' })
  await db.setSetting('bdt_per_usd', (req.body.bdt_per_usd || '120').trim())
  await db.setSetting('max_text_length', (req.body.max_text_length || '125').trim())
  const f = req.files || {}
  const prev = await db.getPaymentQRCodes()
  const qr = { ...prev }
  if (f.qr_nagad && f.qr_nagad[0]) qr.nagad = f.qr_nagad[0].path
  if (f.qr_btc && f.qr_btc[0]) qr.btc = f.qr_btc[0].path
  if (f.qr_ltc && f.qr_ltc[0]) qr.ltc = f.qr_ltc[0].path
  if (f.qr_usdt && f.qr_usdt[0]) qr.usdt = f.qr_usdt[0].path
  if (f.qr_binance && f.qr_binance[0]) qr.binance = f.qr_binance[0].path
  if (f.qr_eth && f.qr_eth[0]) qr.eth = f.qr_eth[0].path
  await db.setPaymentQRCodes(qr)
  if (f.welcome_photo && f.welcome_photo[0]) await db.setSetting('welcome_photo', f.welcome_photo[0].path)
  if (f.welcome_audio && f.welcome_audio[0]) await db.setSetting('welcome_audio', f.welcome_audio[0].path)
  if (f.welcome_document && f.welcome_document[0]) await db.setSetting('welcome_document', f.welcome_document[0].path)
  res.redirect('/admin/settings')
})
app.post('/admin/bot/reset-webhook', ensureAdmin, async (req, res) => {
  try {
    if (bot && baseUrl) await bot.telegram.setWebhook(`${baseUrl}/bot/webhook`)
    res.redirect('/admin/settings')
  } catch (e) { res.redirect('/admin/settings?test_error=' + encodeURIComponent(e.message || 'Webhook error')) }
})
app.post('/admin/bot/delete-webhook', ensureAdmin, async (req, res) => {
  try {
    if (bot) await bot.telegram.deleteWebhook()
    res.redirect('/admin/settings')
  } catch (e) { res.redirect('/admin/settings?test_error=' + encodeURIComponent(e.message || 'Webhook error')) }
})
app.post('/admin/bot/test-message', ensureAdmin, async (req, res) => {
  try {
    const id = adminTelegramId || process.env.ADMIN_TELEGRAM_ID || ''
    if (bot && id) await bot.telegram.sendMessage(id, 'Bot test message: online')
    res.redirect('/admin/settings')
  } catch (e) { res.redirect('/admin/settings?test_error=' + encodeURIComponent(e.message || 'Send failed')) }
})

app.post('/admin/settings/test-eleven', ensureAdmin, async (req, res) => {
  try { await eleven.listVoices(); res.redirect('/admin/settings?test_ok=1') }
  catch (e) { const msg = (e.response && e.response.data && e.response.data.message) ? e.response.data.message : (e.message || 'API test failed'); res.redirect('/admin/settings?test_error=' + encodeURIComponent(msg)) }
})
app.post('/admin/settings/try-tts', ensureAdmin, async (req, res) => {
  try {
    const voices = await db.listVoices(true)
    if (!voices || voices.length === 0) throw new Error('No enabled voices. Sync voices first.')
    const v = voices[0]
    const fp = await eleven.synthesize(v.voice_id, 'Hello from TTS test.')
    const filename = fp.filename
    const savePath = path.join(__dirname, '..', 'uploads', filename)
    fs.writeFileSync(savePath, fp.buffer)
    res.redirect('/admin/settings?test_ok=1&test_audio=' + encodeURIComponent(filename))
  } catch (e) {
    const msg = (e.response && e.response.data && e.response.data.message) ? e.response.data.message : (e.message || 'TTS test failed')
    res.redirect('/admin/settings?test_error=' + encodeURIComponent(msg))
  }
})
app.get('/admin/products', ensureAdmin, async (req, res) => { const products = await db.listProducts(); res.render('products', { products, nav: 'products' }) })
app.post('/admin/products/create', ensureAdmin, upload.single('file'), async (req, res) => {
  const filePath = req.file ? req.file.path : ''
  await db.createProduct({ title: req.body.title, text: req.body.text, price: req.body.price, file: filePath })
  res.redirect('/admin/products')
})
app.post('/admin/products/delete', ensureAdmin, async (req, res) => { await db.deleteProduct(req.body.id); res.redirect('/admin/products') })
app.post('/admin/products/send', ensureAdmin, async (req, res) => {
  const id = req.body.id
  const products = await db.listProducts()
  const p = products.find(x=>x._id===id)
  if (!p) return res.redirect('/admin/products')
  const users = await db.listUsers()
  if (bot) {
    for (const u of users) {
      const caption = `${p.title}\n${p.text || ''}`.trim()
      try {
        if (p.file && p.file.match(/\.(png|jpg|jpeg|gif)$/i)) await bot.telegram.sendPhoto(u.tg_id, { source: p.file }, { caption })
        else if (p.file) await bot.telegram.sendDocument(u.tg_id, { source: p.file }, { caption })
        else await bot.telegram.sendMessage(u.tg_id, caption)
      } catch (_) {}
    }
  }
  res.redirect('/admin/products')
})
app.get('/admin/export', ensureAdmin, async (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="tts-export.zip"')
    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', err => { try { res.end() } catch (_) {} })
    archive.pipe(res)
    archive.file(path.join(__dirname, '..', 'data', 'file.db'), { name: 'data/file.db' })
    archive.directory(path.join(__dirname, '..', 'uploads'), 'uploads')
    await archive.finalize()
  } catch (_) { try { res.status(500).send('Export failed') } catch(e){} }
})
app.post('/admin/import', ensureAdmin, uploadBackup.single('backup'), async (req, res) => {
  try {
    const zipPath = req.file ? req.file.path : ''
    if (!zipPath) { res.redirect('/admin/settings?import_error=' + encodeURIComponent('No file')); return }
    const tempDir = path.join(__dirname, '..', 'uploads', 'restore_' + Date.now())
    fs.mkdirSync(tempDir, { recursive: true })
    await extract(zipPath, { dir: tempDir })
    const dbSrc = path.join(tempDir, 'data', 'file.db')
    const upSrc = path.join(tempDir, 'uploads')
    const dbDst = path.join(__dirname, '..', 'data', 'file.db')
    const upDst = path.join(__dirname, '..', 'uploads')
    function copyDir(src, dst) {
      if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true })
      const entries = fs.readdirSync(src, { withFileTypes: true })
      for (const e of entries) {
        const s = path.join(src, e.name)
        const d = path.join(dst, e.name)
        if (e.isDirectory()) { copyDir(s, d) } else { fs.copyFileSync(s, d) }
      }
    }
    if (fs.existsSync(dbSrc)) fs.copyFileSync(dbSrc, dbDst)
    if (fs.existsSync(upSrc)) copyDir(upSrc, upDst)
    res.redirect('/admin/settings?import_ok=1')
  } catch (e) {
    res.redirect('/admin/settings?import_error=' + encodeURIComponent(e.message || 'Import failed'))
  }
})
app.get('/admin/broadcast', ensureAdmin, async (req, res) => { res.render('broadcast', { nav: 'broadcast', sent: req.query.sent || null }) })
app.post('/admin/broadcast/send', ensureAdmin, uploadBc.fields([{ name: 'photo', maxCount: 1 }, { name: 'audio', maxCount: 1 }, { name: 'document', maxCount: 1 }]), async (req, res) => {
  const text = (req.body.text || '').trim()
  const f = req.files || {}
  const photo = f.photo && f.photo[0] ? f.photo[0].path : ''
  const audio = f.audio && f.audio[0] ? f.audio[0].path : ''
  const document = f.document && f.document[0] ? f.document[0].path : ''
  const users = await db.listUsers()
  if (bot) {
    for (const u of users) {
      try {
        if (photo) await bot.telegram.sendPhoto(u.tg_id, { source: photo }, { caption: text || undefined })
        if (audio) await bot.telegram.sendAudio(u.tg_id, { source: audio }, { caption: text || undefined })
        if (document) await bot.telegram.sendDocument(u.tg_id, { source: document }, { caption: text || undefined })
        if (!photo && !audio && !document && text) await bot.telegram.sendMessage(u.tg_id, text)
      } catch (_) {}
    }
  }
  res.redirect('/admin/broadcast?sent=1')
})
function startServer() {
  const tryListen = p => new Promise((resolve, reject) => {
    const srv = app.listen(p, () => resolve(srv))
    srv.on('error', err => { if (err.code === 'EADDRINUSE') { try { srv.close() } catch (_) {} } reject(err) })
  })
  ;(async () => {
    await ensureAdminHashSync()
    let p = port
    for (let i = 0; i < 5; i++) {
      try {
        await tryListen(p)
        const shown = baseUrl ? baseUrl : `http://localhost:${p}`
        console.log(`Admin panel on ${shown}`)
        break
      } catch (e) {
        if (e.code === 'EADDRINUSE') { p++; continue }
        throw e
      }
    }
  })()
}
module.exports = { startServer }
