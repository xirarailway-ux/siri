const { Telegraf, Markup } = require('telegraf')
const path = require('path')
const fs = require('fs')
const os = require('os')
const axios = require('axios')
const ffmpeg = require('fluent-ffmpeg')
const { botToken, adminTelegramId } = require('./config')
const db = require('./db')
const eleven = require('./elevenlabs')

async function downloadFile(url, dest) {
  const writer = fs.createWriteStream(dest)
  const response = await axios({ url, method: 'GET', responseType: 'stream' })
  response.data.pipe(writer)
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

async function convertAudioToVoice(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('ogg')
      .audioCodec('libopus')
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath)
  })
}

async function convertVideoToNote(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .size('384x384')
      .videoCodec('libx264')
      .audioCodec('aac')
      .format('mp4')
      .outputOptions([
        '-vf', 'crop=min(iw\\,ih):min(iw\\,ih),scale=384:384',
        '-movflags', '+faststart',
        '-t', '60'
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath)
  })
}

if (!botToken) throw new Error('BOT_TOKEN missing')
const bot = new Telegraf(botToken)

bot.use(async (ctx, next) => {
  if (ctx.message) {
    const type = ctx.message.video ? 'video' : (ctx.message.document ? 'document' : (ctx.message.audio ? 'audio' : (ctx.message.voice ? 'voice' : 'text')))
    console.log(`Received message type: ${type} from ${ctx.from.id}`)
  }
  await next()
})

function keyboard() {
  return Markup.keyboard([
    ['Plans', 'Models'],
    ['Profile', 'Contact'],
    ['Help']
  ]).resize().persistent()
}

async function sendWelcome(ctx) {
  const u = ctx.from
  await db.upsertUser({ tg_id: String(u.id), username: u.username || '', first_name: u.first_name || '', last_name: u.last_name || '' })
  
  const msg = `👋 Welcome! 
I’m glad you’re here. 
Use the menu below or send a command to get started. If you need help at any time, just type   😊`

  try {
    const photo = await db.getSetting('welcome_photo')
    const audio = await db.getSetting('welcome_audio')
    const document = await db.getSetting('welcome_document')
    
    const kb = keyboard()
    const extra = { caption: msg, ...kb }
    let sent = false

    if (audio) {
      // Send as voice message (prioritize audio/voice)
      try {
        // Attempt to convert to OGG Opus for "real waves"
        let sentVoice = false
        try {
          const tempDir = os.tmpdir()
          const uniqueId = Date.now() + Math.random().toString(36).substring(7)
          const inputPath = path.join(tempDir, `welcome_in_${uniqueId}`) 
          const outputPath = path.join(tempDir, `welcome_out_${uniqueId}.ogg`)
          let hasFile = false

          if (audio.startsWith('http') || audio.startsWith('https')) {
            await downloadFile(audio, inputPath)
            hasFile = true
          } else if (fs.existsSync(audio)) {
            fs.copyFileSync(audio, inputPath)
            hasFile = true
          }

          if (hasFile) {
            await convertAudioToVoice(inputPath, outputPath)
            await ctx.replyWithVoice({ source: outputPath }, extra)
            sentVoice = true
            // Cleanup
            try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch(_) {}
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch(_) {}
          }
        } catch (convErr) {
          console.error('Welcome voice conversion failed:', convErr)
        }

        if (!sentVoice) {
          await ctx.replyWithVoice({ source: audio }, extra)
        }
        sent = true
      } catch (e) {
        console.error('Error sending voice:', e)
        // If voice fails (e.g. format), try audio
        try {
          await ctx.replyWithAudio({ source: audio }, extra)
          sent = true
        } catch (_) {}
      }
    }
    
    if (!sent && photo) {
      try {
        await ctx.replyWithPhoto({ source: photo }, extra)
        sent = true
      } catch (_) {}
    }

    if (!sent && document) {
      try {
        await ctx.replyWithDocument({ source: document }, extra)
        sent = true
      } catch (_) {}
    }
    
    // Fallback: just text
    if (!sent) {
      await ctx.reply(msg, kb)
    }
    
  } catch(e){
    console.error('Welcome error:', e)
    // Final fallback
    await ctx.reply(msg, keyboard())
  }
  
  // Check for free credits
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
}

bot.use(async (ctx, next) => {
  if (ctx.from) {
    const user = await db.getUserByTgId(String(ctx.from.id))
    if (!user) {
      await sendWelcome(ctx)
      return
    }
  }
  await next()
})

bot.start(sendWelcome)
bot.hears('Contact', async ctx => {
  const instr = await db.getSetting('contact') || 'Contact admin: @TheMysteriousGhost'
  await ctx.reply(instr, keyboard())
})
bot.hears('Help', async ctx => {
  const kb = keyboard()
  const maxRaw = await db.getSetting('max_text_length') || '125'
  const maxLen = parseInt(String(maxRaw), 10) || 125
  let help = await db.getSetting('help_text')
  if (!help) {
    help = [
      '<b>How to use Hey Siri</b>',
      '• <b>Models</b>: choose your voice model.',
      '• <b>Plans</b>: buy credits (1 credit per generation).',
      `• <b>Generate</b>: send a text message (max ${maxLen} chars) to get TTS audio.`,
      '• <b>Free credit</b>: join our channel <a href="https://t.me/Siriupdates">Siriupdates</a> and tap <b>Verify</b> to get 1 free credit (first time only).',
      '• <b>Payments</b>: after picking a plan and method, pay and send the screenshot here; admin will approve.',
      '• <b>Profile</b>: see credits, selected voice, expiry and last purchase.',
      '• <b>Contact</b>: message admin <b>@TheMysteriousGhost</b> for support.'
    ].join('\\n')
  } else {
    help = help
      .replaceAll('{{MAX_LEN}}', String(maxLen))
      .replaceAll('{{CHANNEL}}', 'https://t.me/Siriupdates')
      .replaceAll('{{ADMIN}}', '@TheMysteriousGhost')
  }
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
  try {
    await ctx.editMessageText('Voice selected')
  } catch (e) {
    if (!e.description?.includes('message is not modified')) {
      console.error('Error editing message:', e)
    }
  }
})
bot.hears('Plans', async ctx => {
  const plist = await db.listPlans(true)
  if (plist.length === 0) {
    await ctx.reply('No plans available. Please try later.', keyboard())
    return
  }
  const rows = plist.map(p => [Markup.button.callback(`${p.name} (${p.credits} credits) - $${p.price}`, `buy_plan:${p._id}`)])
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
  try {
    await ctx.editMessageCaption('Approved')
    
    // Notify user
    const u = await db.getUserById(p.user_id)
    if (u && u.tg_id) {
      const msg = `
✅ <b>Payment Approved!</b>

<b>Plan Activated:</b> ${plan.name}
<b>Credits Added:</b> ${plan.credits}
<b>Payment Method:</b> ${p.method ? p.method.toUpperCase() : 'Unknown'}
<b>Total Credits:</b> ${(u.credits || 0) + plan.credits}
${plan.valid_days ? `<b>Validity:</b> ${plan.valid_days} days` : ''}

Thank you for your purchase!
`.trim()
      await ctx.telegram.sendMessage(u.tg_id, msg, { parse_mode: 'HTML' })
    }
  } catch (e) {
    console.error('Bot Approval Error:', e)
  }
})
bot.action(/reject_payment:(.+)/, async ctx => {
  const id = ctx.match[1]
  const p = await db.getPaymentById(id)
  if (!p || p.status !== 'pending') { await ctx.answerCbQuery('Not pending'); return }
  await db.updatePaymentStatus(id, 'rejected', String(ctx.from.id))
  await ctx.answerCbQuery('Rejected')
  try {
    await ctx.editMessageCaption('Rejected')
  } catch (e) {
    if (!e.description?.includes('message is not modified')) console.error(e)
  }
})
bot.on('text', async ctx => {
  const text = ctx.message.text.trim()
  if (!text) return
  if (['Plans','Models','Profile','Contact'].includes(text)) return
  const maxRaw = await db.getSetting('max_text_length') || '125'
  const maxLen = parseInt(String(maxRaw), 10) || 125
  if (text.length > maxLen) { await ctx.reply(`Text too long. Max ${maxLen} characters.`, keyboard()); return }
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
      try {
        await ctx.replyWithVoice({ source: out.buffer, filename: out.filename })
      } catch (e) {
        if (e.description && e.description.includes('VOICE_MESSAGES_FORBIDDEN')) {
          await ctx.replyWithAudio({ source: out.buffer, filename: out.filename })
        } else {
          throw e
        }
      }
    } else {
      await ctx.replyWithAudio({ source: out.buffer, filename: out.filename })
    }
    const after = await db.getUserById(user._id)
    if ((after.credits||0) === 0) { await ctx.reply('You used all credits. Plan expired.') }
  } catch (e) {
    console.error('TTS Error:', e)
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
bot.on(['audio', 'voice'], async ctx => {
  const msg = await ctx.reply('Processing audio...')
  const tempDir = os.tmpdir()
  const inputId = ctx.message.audio ? ctx.message.audio.file_id : ctx.message.voice.file_id
  const ext = ctx.message.audio ? '.mp3' : '.ogg'
  const inputPath = path.join(tempDir, `input_${inputId}${ext}`)
  const outputPath = path.join(tempDir, `output_${inputId}.ogg`)
  
  try {
    const link = await ctx.telegram.getFileLink(inputId)
    await downloadFile(link.href, inputPath)
    
    await convertAudioToVoice(inputPath, outputPath)
    
    await ctx.replyWithVoice({ source: outputPath })
    await ctx.deleteMessage(msg.message_id).catch(()=>{})
  } catch (e) {
    console.error('Audio/Voice error:', e)
    await ctx.reply('Could not convert to voice message.')
  } finally {
    try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch(_) {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch(_) {}
  }
})

async function processVideoMessage(ctx, file) {
  if (file.file_size > 15 * 1024 * 1024) {
    await ctx.reply('Video is too large. Max 15MB.')
    return
  }
  const msg = await ctx.reply('Processing video note...')
  const tempDir = os.tmpdir()
  const inputPath = path.join(tempDir, `input_${file.file_id}.mp4`)
  const outputPath = path.join(tempDir, `output_${file.file_id}.mp4`)

  try {
    const link = await ctx.telegram.getFileLink(file.file_id)
    await downloadFile(link.href, inputPath)
    
    await convertVideoToNote(inputPath, outputPath)
    
    await ctx.replyWithVideoNote({ source: outputPath })
    await ctx.deleteMessage(msg.message_id).catch(()=>{})
  } catch (e) {
    console.error('Video note error:', e)
    await ctx.reply('Could not convert to rounded video. Ensure video format is supported.')
  } finally {
    try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch(_) {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch(_) {}
  }
}

bot.on('video', async ctx => {
  await processVideoMessage(ctx, ctx.message.video)
})

bot.on('document', async ctx => {
  const doc = ctx.message.document
  if (doc.mime_type && doc.mime_type.startsWith('video/')) {
    await processVideoMessage(ctx, doc)
  }
})

module.exports = { bot }
