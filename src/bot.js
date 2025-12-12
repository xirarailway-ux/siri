const { Telegraf, Markup } = require('telegraf')
const path = require('path')
const fs = require('fs')
const { botToken, adminTelegramId } = require('./config')
const db = require('./db')
const eleven = require('./elevenlabs')
if (!botToken) throw new Error('BOT_TOKEN missing')
const bot = new Telegraf(botToken)
function keyboard() {
  return Markup.keyboard([
    ['Plans', 'Models'],
    ['Profile', 'Contact'],
    ['Help']
  ]).resize().persistent()
}
bot.start(async ctx => {
  const u = ctx.from
  await db.upsertUser({ tg_id: String(u.id), username: u.username || '', first_name: u.first_name || '', last_name: u.last_name || '' })
  const msg = await db.getSetting('welcome_message') || 'Welcome to ElevenLabs TTS Bot'
  try {
    const photo = await db.getSetting('welcome_photo')
    const audio = await db.getSetting('welcome_audio')
    const document = await db.getSetting('welcome_document')
    if (photo) { try { await ctx.replyWithPhoto({ source: photo }, { caption: msg }) } catch(_){} }
    if (audio) { try { await ctx.replyWithAudio({ source: audio }, { caption: msg }) } catch(_){} }
    if (document) { try { await ctx.replyWithDocument({ source: document }, { caption: msg }) } catch(_){} }
  } catch(_){}
  await ctx.reply(msg, keyboard())
  try {
    const user = await db.getUserByTgId(String(u.id))
    if ((user.credits||0) === 0 && (user.free_credit_claimed||0) !== 1) {
      const joinKb = Markup.inlineKeyboard([
        [Markup.button.url('Join Channel', 'https://t.me/Siriupdates')],
        [Markup.button.callback('Verify Join', 'verify_join')]
      ])
      await ctx.reply('Join our community channel to get 1 free voice credit, then tap Verify.', joinKb)
    }
  } catch (_) {}
})
bot.hears('Contact', async ctx => {
  const instr = await db.getSetting('contact') || 'Contact admin: @TheMysteriousGhost'
  await ctx.reply(instr, keyboard())
})
bot.hears('Help', async ctx => {
  const kb = keyboard()
  const help = [
    '<b>How to use Hey Siri</b>',
    '• <b>Models</b>: choose your voice model.',
    '• <b>Plans</b>: buy credits (1 credit per generation).',
    '• <b>Generate</b>: send a text message (max 200 chars) to get TTS audio.',
    '• <b>Free credit</b>: join our channel <a href="https://t.me/Siriupdates">Siriupdates</a> and tap <b>Verify</b> to get 1 free credit (first time only).',
    '• <b>Payments</b>: after picking a plan and method, pay and send the screenshot here; admin will approve.',
    '• <b>Profile</b>: see credits, selected voice, expiry and last purchase.',
    '• <b>Contact</b>: message admin <b>@TheMysteriousGhost</b> for support.'
  ].join('\n')
  await ctx.reply(help, { parse_mode: 'HTML', reply_markup: kb.reply_markup })
})
bot.hears('Profile', async ctx => {
  const tgId = String(ctx.from.id)
  const user = await db.getUserByTgId(tgId)
  const credits = user ? (user.credits || 0) : 0
  const voice = user && user.selected_voice_id ? user.selected_voice_id : 'Not set'
  let expiry = 'None'
  let daysLeft = ''
  if (user && user.credit_expires_at) {
    const dt = new Date(user.credit_expires_at).getTime()
    if (!Number.isNaN(dt)) {
      const diffDays = Math.ceil((dt - Date.now()) / (24*3600*1000))
      expiry = new Date(dt).toLocaleDateString()
      daysLeft = diffDays >= 0 ? ` (${diffDays} days left)` : ' (expired)'
    }
  }
  let lastPurchase = 'None'
  try {
    const pays = await db.listPaymentsByUserTg(tgId)
    const ap = pays.find(p => p.status === 'approved')
    if (ap) lastPurchase = `${ap.plan_name || ''} • ${new Date(ap.created_at).toLocaleDateString()}`
  } catch (_) {}
  const kb = keyboard()
  const html = [
    '<b>Profile</b>',
    `<b>Credits:</b> ${credits}`,
    `<b>Voice:</b> ${voice}`,
    `<b>Expiry:</b> ${expiry}${daysLeft}`,
    `<b>Last purchase:</b> ${lastPurchase}`
  ].join('\n')
  await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb.reply_markup })
})
bot.hears('Models', async ctx => {
  let vlist = await db.listVoices(true)
  if (vlist.length === 0) {
    try {
      const apiVoices = await eleven.listVoices()
      await db.setVoices(apiVoices)
      vlist = await db.listVoices(true)
    } catch (e) {
      const contactMsg = await db.getSetting('contact') || 'Contact support via admin.'
      await ctx.reply(contactMsg, keyboard())
      return
    }
  }
  const rows = []
  const chunk = 3
  vlist.slice(0, 24).forEach((v, i) => {
    if (i % chunk === 0) rows.push([])
    rows[rows.length - 1].push(Markup.button.callback(v.name, `set_voice:${v.voice_id}`))
  })
  await ctx.reply('Choose a voice model', Markup.inlineKeyboard(rows))
})
bot.action(/set_voice:(.+)/, async ctx => {
  const voiceId = ctx.match[1]
  await db.setUserVoice(String(ctx.from.id), voiceId)
  await ctx.answerCbQuery('Voice selected')
  await ctx.editMessageText('Voice selected')
})
bot.hears('Plans', async ctx => {
  const plist = await db.listPlans(true)
  if (plist.length === 0) {
    await ctx.reply('No plans available. Please try later.', keyboard())
    return
  }
  const rows = plist.map(p => [Markup.button.callback(`${p.name} (${p.credits} credits)`, `buy_plan:${p._id}`)])
  await ctx.reply('Choose a plan', Markup.inlineKeyboard(rows))
})
bot.action(/buy_plan:(.+)/, async ctx => {
  const planId = ctx.match[1]
  const tgId = String(ctx.from.id)
  const user = await db.getUserByTgId(tgId)
  if (!user) return
  await db.setAwaitingPlan(user._id, planId)
  const pm = await db.getPaymentMethods()
  const available = Object.entries(pm).filter(([k,v])=>v)
  const methods = available.map(([k]) => [Markup.button.callback(k.toUpperCase(), `pay_with:${k}:${planId}`)])
  await ctx.answerCbQuery('Plan selected')
  await ctx.reply('Choose a payment method', Markup.inlineKeyboard(methods))
})
bot.action(/pay_with:(.+):(.+)/, async ctx => {
  const method = ctx.match[1]
  const planId = ctx.match[2]
  const tgId = String(ctx.from.id)
  const user = await db.getUserByTgId(tgId)
  if (!user) return
  await db.setAwaitingPlan(user._id, planId)
  await db.setAwaitingMethod(user._id, method)
  const plan = await db.getPlanById(planId)
  const pm = await db.getPaymentMethods()
  const qr = await db.getPaymentQRCodes()
  const address = pm[method] || ''
  const amount = plan ? plan.price : ''
  const usd = parseFloat(String(amount).replace(/[^0-9.]/g,'')) || 0
  const rateRaw = await db.getSetting('bdt_per_usd') || '120'
  const rate = parseFloat(String(rateRaw).replace(/[^0-9.]/g,'')) || 120
  const bdt = Math.round(usd * rate)
  await ctx.answerCbQuery('Method selected')
  let text = `Payment method: ${method.toUpperCase()}\nAddress: ${address}\nAmount: ${amount}`
  if (method === 'nagad') {
    text += `\nRate: 1 USD = ${rate} BDT\nPay in BDT: ~${bdt}`
  }
  if (qr && qr[method]) {
    try { await ctx.replyWithPhoto({ source: qr[method] }, { caption: text }) } catch (_) { await ctx.reply(text) }
  } else {
    await ctx.reply(text)
  }
  const instructions = await db.getSetting('payment_instructions') || ''
  if (instructions) await ctx.reply(instructions)
  await ctx.reply('Send payment screenshot here after paying.', keyboard())
})
bot.on('photo', async ctx => {
  const tgId = String(ctx.from.id)
  const user = await db.getUserByTgId(tgId)
  if (!user || !user.awaiting_plan_id) return
  const photos = ctx.message.photo
  const file = photos[photos.length - 1]
  const link = await ctx.telegram.getFileLink(file.file_id)
  const res = await fetch(link.href)
  const buf = Buffer.from(await res.arrayBuffer())
  const dir = path.join(__dirname, '..', 'uploads', 'payments')
  fs.mkdirSync(dir, { recursive: true })
  const name = `payment_${user._id}_${Date.now()}.jpg`
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, buf)
  const payment = await db.createPayment(user._id, user.awaiting_plan_id, filePath, user.awaiting_method || '')
  const lastId = payment._id
  await db.clearAwaitingPlan(user._id)
  await db.clearAwaitingMethod(user._id)
  await ctx.reply('Payment submitted. Waiting for admin approval.', keyboard())
  if (adminTelegramId) {
    const plan = await db.getPlanById(user.awaiting_plan_id)
    await bot.telegram.sendPhoto(adminTelegramId, { source: filePath }, {
      caption: `Payment submitted by @${user.username || tgId} for plan ${plan ? plan.name : ''} via ${user.awaiting_method || ''}`,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Approve', callback_data: `approve_payment:${lastId}` },
          { text: 'Reject', callback_data: `reject_payment:${lastId}` }
        ]]
      }
    })
  }
})
bot.action(/approve_payment:(.+)/, async ctx => {
  const id = ctx.match[1]
  const p = await db.getPaymentById(id)
  if (!p || p.status !== 'pending') { await ctx.answerCbQuery('Not pending'); return }
  const plan = await db.getPlanById(p.plan_id)
  await db.updatePaymentStatus(id, 'approved', String(ctx.from.id))
  await db.addCredits(p.user_id, plan.credits, plan.valid_days)
  await ctx.answerCbQuery('Approved')
  await ctx.editMessageCaption({ caption: 'Approved' })
})
bot.action(/reject_payment:(.+)/, async ctx => {
  const id = ctx.match[1]
  const p = await db.getPaymentById(id)
  if (!p || p.status !== 'pending') { await ctx.answerCbQuery('Not pending'); return }
  await db.updatePaymentStatus(id, 'rejected', String(ctx.from.id))
  await ctx.answerCbQuery('Rejected')
  await ctx.editMessageCaption({ caption: 'Rejected' })
})
bot.on('text', async ctx => {
  const text = ctx.message.text.trim()
  if (!text) return
  if (['Plans','Models','Profile','Contact'].includes(text)) return
  if (text.length > 200) { await ctx.reply('Text too long. Max 200 characters.', keyboard()); return }
  const tgId = String(ctx.from.id)
  const user = await db.getUserByTgId(tgId)
  if (!user) return
  await db.enforceExpiryByTg(tgId)
  const refreshed = await db.getUserByTgId(tgId)
  if ((refreshed.credits||0) === 0) { await ctx.reply('You don’t have voice credits. Open Plans to buy.'); return }
  if (user.is_blocked) { await ctx.reply('Access blocked'); return }
  if (!user.selected_voice_id) { await ctx.reply('Choose a voice in Models'); return }
  if (user.credits <= 0) { await ctx.reply('You don’t have voice credits. Open Plans to buy.'); return }
  try {
    const out = await eleven.synthesize(user.selected_voice_id, text)
    await db.consumeCredit(user._id)
    await db.recordGeneration(user._id, user.selected_voice_id, text.length, '')
    await db.touchUserGenerationById(user._id)
    if (out.filename.endsWith('.ogg')) {
      await ctx.replyWithVoice({ source: out.buffer, filename: out.filename })
    } else {
      await ctx.replyWithAudio({ source: out.buffer, filename: out.filename })
    }
    const after = await db.getUserById(user._id)
    if ((after.credits||0) === 0) { await ctx.reply('You used all credits. Plan expired.') }
  } catch (e) {
    const contactMsg = await db.getSetting('contact') || 'Contact support via admin.'
    await ctx.reply(contactMsg)
    const adminId = process.env.ADMIN_TELEGRAM_ID || ''
    if (adminId) { try { await ctx.telegram.sendMessage(adminId, `TTS error for ${tgId}: ${e && e.message ? e.message : 'Unknown error'}`) } catch(_){} }
  }
})
bot.action('verify_join', async ctx => {
  try {
    const tgId = String(ctx.from.id)
    const user = await db.getUserByTgId(tgId)
    if (!user) return
    if ((user.free_credit_claimed||0) === 1) { await ctx.answerCbQuery('Already claimed'); return }
    const info = await ctx.telegram.getChatMember('@Siriupdates', Number(tgId))
    const status = info && info.status ? String(info.status) : 'left'
    if (['member','administrator','creator'].includes(status)) {
      await db.addCreditsByTg(tgId, 1, 0)
      await db.markFreeCreditClaimedByTg(tgId)
      await ctx.answerCbQuery('Verified')
      await ctx.reply('Verified! You received 1 free voice credit.')
    } else {
      await ctx.answerCbQuery('Not joined yet')
      await ctx.reply('Join the channel first, then tap Verify.')
    }
  } catch (_) {
    await ctx.answerCbQuery('Verification failed')
    await ctx.reply('Could not verify. Ensure the bot was added to the channel @Siriupdates.')
  }
})
module.exports = { bot }
