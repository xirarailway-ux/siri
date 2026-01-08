const mysql = require('mysql2/promise')
const { v4: uuid } = require('uuid')
const { databaseUrl } = require('./config')

const pool = mysql.createPool(databaseUrl || process.env.MYSQL_URL)

async function init() {
  const conn = await pool.getConnection()
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS users (
      _id VARCHAR(36) PRIMARY KEY,
      tg_id VARCHAR(50) UNIQUE,
      username VARCHAR(255),
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      credits INT DEFAULT 0,
      is_blocked TINYINT DEFAULT 0,
      created_at DATETIME,
      credit_expires_at DATETIME,
      last_generation_at DATETIME,
      free_credit_claimed TINYINT DEFAULT 0,
      selected_voice_id VARCHAR(255),
      awaiting_plan_id VARCHAR(36),
      awaiting_method VARCHAR(50)
    )`)
    await conn.query(`CREATE TABLE IF NOT EXISTS voices (
      voice_id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255),
      enabled TINYINT DEFAULT 1
    )`)
    await conn.query(`CREATE TABLE IF NOT EXISTS plans (
      _id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255),
      credits INT,
      price VARCHAR(50),
      valid_days INT,
      is_active TINYINT DEFAULT 1
    )`)
    await conn.query(`CREATE TABLE IF NOT EXISTS payments (
      _id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36),
      plan_id VARCHAR(36),
      method VARCHAR(50),
      status VARCHAR(50),
      screenshot_path TEXT,
      created_at DATETIME,
      approved_at DATETIME,
      admin_id VARCHAR(50)
    )`)
    await conn.query(`CREATE TABLE IF NOT EXISTS generations (
      _id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36),
      voice_id VARCHAR(255),
      text_length INT,
      audio_path TEXT,
      created_at DATETIME
    )`)
    await conn.query(`CREATE TABLE IF NOT EXISTS settings (
      key_name VARCHAR(100) PRIMARY KEY,
      value TEXT
    )`)
    await conn.query(`CREATE TABLE IF NOT EXISTS products (
      _id VARCHAR(36) PRIMARY KEY,
      title VARCHAR(255),
      text TEXT,
      price VARCHAR(50),
      file TEXT,
      created_at DATETIME
    )`)
  } catch (e) {
    console.error('DB Init Error:', e)
  } finally {
    conn.release()
  }
}

async function getUserByTgId(tgId) {
  const [rows] = await pool.query('SELECT * FROM users WHERE tg_id = ?', [tgId])
  return rows[0] || null
}

async function upsertUser(profile) {
  const existing = await getUserByTgId(profile.tg_id)
  if (existing) {
    await pool.query('UPDATE users SET username=?, first_name=?, last_name=? WHERE tg_id=?', 
      [profile.username, profile.first_name, profile.last_name, profile.tg_id])
  } else {
    await pool.query('INSERT INTO users (_id, tg_id, username, first_name, last_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), profile.tg_id, profile.username, profile.first_name, profile.last_name, new Date()])
  }
  return getUserByTgId(profile.tg_id)
}

async function setUserVoice(tgId, voiceId) {
  await pool.query('UPDATE users SET selected_voice_id=? WHERE tg_id=?', [voiceId, tgId])
}

async function addCredits(userId, amount, valid_days) {
  const [rows] = await pool.query('SELECT credits FROM users WHERE _id=?', [userId])
  if (rows.length === 0) return
  let newCredits = (rows[0].credits || 0) + amount
  let expiry = null
  if (valid_days && valid_days > 0) {
    const dt = new Date()
    dt.setDate(dt.getDate() + valid_days)
    expiry = dt
    await pool.query('UPDATE users SET credits=?, credit_expires_at=? WHERE _id=?', [newCredits, expiry, userId])
  } else {
    await pool.query('UPDATE users SET credits=? WHERE _id=?', [newCredits, userId])
  }
}

async function removeCredits(userId, amount) {
  const [rows] = await pool.query('SELECT credits FROM users WHERE _id=?', [userId])
  if (rows.length === 0) return
  let next = (rows[0].credits || 0) - amount
  if (next < 0) next = 0
  if (next === 0) {
    await pool.query('UPDATE users SET credits=?, credit_expires_at=? WHERE _id=?', [0, new Date(), userId])
  } else {
    await pool.query('UPDATE users SET credits=? WHERE _id=?', [next, userId])
  }
}

async function addCreditsByTg(tgId, amount, valid_days) {
  const u = await getUserByTgId(tgId)
  if (u) await addCredits(u._id, amount, valid_days)
}

async function removeCreditsByTg(tgId, amount) {
  const u = await getUserByTgId(tgId)
  if (u) await removeCredits(u._id, amount)
}

async function consumeCredit(userId) {
  const [rows] = await pool.query('SELECT credits FROM users WHERE _id=?', [userId])
  if (rows.length === 0) return
  let c = rows[0].credits
  if (c > 0) {
    c -= 1
    if (c === 0) {
      await pool.query('UPDATE users SET credits=?, credit_expires_at=? WHERE _id=?', [0, new Date(), userId])
    } else {
      await pool.query('UPDATE users SET credits=? WHERE _id=?', [c, userId])
    }
  }
}

async function expireIfPast(user) {
  if (user && user.credit_expires_at && new Date(user.credit_expires_at).getTime() < Date.now()) {
    await pool.query('UPDATE users SET credits=0 WHERE _id=?', [user._id])
    user.credits = 0
    return true
  }
  return false
}

async function enforceExpiryByTg(tgId) {
  const user = await getUserByTgId(tgId)
  if (user && user.credit_expires_at && new Date(user.credit_expires_at).getTime() < Date.now() && (user.credits||0)>0) {
    await pool.query('UPDATE users SET credits=0 WHERE _id=?', [user._id])
    return true
  }
  return false
}

async function listVoices(enabledOnly=true) {
  if (enabledOnly) {
    const [rows] = await pool.query('SELECT * FROM voices WHERE enabled=1')
    return rows
  } else {
    const [rows] = await pool.query('SELECT * FROM voices')
    return rows
  }
}

async function setVoices(vs) {
  for (const v of vs) {
    const [rows] = await pool.query('SELECT voice_id FROM voices WHERE voice_id=?', [v.voice_id])
    if (rows.length > 0) {
      await pool.query('UPDATE voices SET name=?, enabled=1 WHERE voice_id=?', [v.name, v.voice_id])
    } else {
      await pool.query('INSERT INTO voices (voice_id, name, enabled) VALUES (?, ?, 1)', [v.voice_id, v.name])
    }
  }
}

async function setVoiceEnabled(voiceId, enabled) {
  await pool.query('UPDATE voices SET enabled=? WHERE voice_id=?', [enabled?1:0, voiceId])
}

async function addVoice(voice_id, name) {
  const [rows] = await pool.query('SELECT voice_id FROM voices WHERE voice_id=?', [voice_id])
  if (rows.length === 0) {
    await pool.query('INSERT INTO voices (voice_id, name, enabled) VALUES (?, ?, 1)', [voice_id, name])
  }
}

async function removeVoice(voice_id) {
  await pool.query('DELETE FROM voices WHERE voice_id=?', [voice_id])
}

async function createPlan(name, credits, price, valid_days) {
  const id = uuid()
  await pool.query('INSERT INTO plans (_id, name, credits, price, valid_days, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [id, name, credits, price, valid_days || 0])
  return { _id: id }
}

async function listPlans(activeOnly=true) {
  if (activeOnly) {
    const [rows] = await pool.query('SELECT * FROM plans WHERE is_active=1')
    return rows
  } else {
    const [rows] = await pool.query('SELECT * FROM plans')
    return rows
  }
}

async function setPlanActive(id, active) {
  await pool.query('UPDATE plans SET is_active=? WHERE _id=?', [active?1:0, id])
}

async function getPlanById(id) {
  const [rows] = await pool.query('SELECT * FROM plans WHERE _id=?', [id])
  return rows[0] || null
}

async function deletePlan(id) {
  await pool.query('DELETE FROM plans WHERE _id=?', [id])
}

async function setAwaitingPlan(userId, planId) {
  await pool.query('UPDATE users SET awaiting_plan_id=? WHERE _id=?', [planId, userId])
}

async function clearAwaitingPlan(userId) {
  await pool.query('UPDATE users SET awaiting_plan_id=NULL WHERE _id=?', [userId])
}

async function setAwaitingMethod(userId, method) {
  await pool.query('UPDATE users SET awaiting_method=? WHERE _id=?', [method, userId])
}

async function clearAwaitingMethod(userId) {
  await pool.query('UPDATE users SET awaiting_method=NULL WHERE _id=?', [userId])
}

async function listUsers() {
  const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at DESC')
  return rows
}

async function getUserById(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE _id=?', [id])
  return rows[0] || null
}

async function getUserInternalIdByTg(tgId) {
  const u = await getUserByTgId(tgId)
  return u ? u._id : null
}

async function pendingPayments() {
  const [rows] = await pool.query(`
    SELECT p.*, u.username, pl.name as plan_name 
    FROM payments p 
    LEFT JOIN users u ON p.user_id = u._id 
    LEFT JOIN plans pl ON p.plan_id = pl._id 
    WHERE p.status='pending' 
    ORDER BY p.created_at DESC
  `)
  return rows
}

async function allPayments() {
  const [rows] = await pool.query(`
    SELECT p.*, u.username, pl.name as plan_name 
    FROM payments p 
    LEFT JOIN users u ON p.user_id = u._id 
    LEFT JOIN plans pl ON p.plan_id = pl._id 
    ORDER BY p.created_at DESC
  `)
  return rows
}

async function listPaymentsByUser(userId) {
  const [rows] = await pool.query(`
    SELECT p.*, pl.name as plan_name 
    FROM payments p 
    LEFT JOIN plans pl ON p.plan_id = pl._id 
    WHERE p.user_id=? 
    ORDER BY p.created_at DESC
  `, [userId])
  return rows
}

async function listPaymentsByUserTg(tgId) {
  const id = await getUserInternalIdByTg(tgId)
  if (!id) return []
  return listPaymentsByUser(id)
}

async function createPayment(userId, planId, screenshotPath, method) {
  const id = uuid()
  const now = new Date()
  await pool.query('INSERT INTO payments (_id, user_id, plan_id, method, status, screenshot_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, userId, planId, method||'', 'pending', screenshotPath, now])
  return { _id: id, status: 'pending', created_at: now.toISOString() }
}

async function updatePaymentStatus(id, status, adminId) {
  await pool.query('UPDATE payments SET status=?, approved_at=?, admin_id=? WHERE _id=?',
    [status, new Date(), adminId||null, id])
}

async function getPaymentById(id) {
  const [rows] = await pool.query('SELECT * FROM payments WHERE _id=?', [id])
  return rows[0] || null
}

async function recordGeneration(userId, voiceId, textLength, audioPath) {
  const id = uuid()
  await pool.query('INSERT INTO generations (_id, user_id, voice_id, text_length, audio_path, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, voiceId, textLength, audioPath, new Date()])
}

async function touchUserGenerationById(userId) {
  await pool.query('UPDATE users SET last_generation_at=? WHERE _id=?', [new Date(), userId])
}

async function listGenerationsByUser(userId) {
  const [rows] = await pool.query('SELECT * FROM generations WHERE user_id=? ORDER BY created_at DESC', [userId])
  return rows
}

async function listGenerationsByUserTg(tgId) {
  const id = await getUserInternalIdByTg(tgId)
  if (!id) return []
  return listGenerationsByUser(id)
}

async function setSetting(key, value) {
  const [rows] = await pool.query('SELECT key_name FROM settings WHERE key_name=?', [key])
  if (rows.length > 0) {
    await pool.query('UPDATE settings SET value=? WHERE key_name=?', [value, key])
  } else {
    await pool.query('INSERT INTO settings (key_name, value) VALUES (?, ?)', [key, value])
  }
}

async function getSetting(key) {
  const [rows] = await pool.query('SELECT value FROM settings WHERE key_name=?', [key])
  return rows.length > 0 ? rows[0].value : null
}

async function setPaymentMethods(obj) { await setSetting('payment_methods', JSON.stringify(obj||{})) }
async function getPaymentMethods() { const raw = await getSetting('payment_methods'); try { return raw ? JSON.parse(raw) : {} } catch (_) { return {} } }

async function setPaymentQRCodes(obj) { await setSetting('payment_qr', JSON.stringify(obj||{})) }
async function getPaymentQRCodes() { const raw = await getSetting('payment_qr'); try { return raw ? JSON.parse(raw) : {} } catch (_) { return {} } }

async function setUserBlocked(id, blocked) {
  await pool.query('UPDATE users SET is_blocked=? WHERE _id=?', [blocked?1:0, id])
}

async function setUserBlockedByTg(tgId, blocked) {
  await pool.query('UPDATE users SET is_blocked=? WHERE tg_id=?', [blocked?1:0, tgId])
}

async function stats() {
  const [userRows] = await pool.query('SELECT count(*) as c FROM users')
  const [genRows] = await pool.query('SELECT count(*) as c FROM generations')
  const [pendRows] = await pool.query("SELECT count(*) as c FROM payments WHERE status='pending'")
  const [salesRows] = await pool.query("SELECT count(*) as c FROM payments WHERE status='approved'")
  
  const [buyerRows] = await pool.query("SELECT count(DISTINCT user_id) as c FROM payments WHERE status='approved'")
  const [activeCreditRows] = await pool.query('SELECT count(*) as c FROM users WHERE credits > 0')
  
  // inactiveWithCredits: complex logic in JS, simplified here or fetched.
  // Original: u.credits > 0 && (!u.last_generation_at || (Date.now() - new Date(u.last_generation_at).getTime()) > 5*24*3600*1000)
  // We can just fetch all users with credits > 0 and filter in JS for simplicity
  const [usersWithCredits] = await pool.query('SELECT * FROM users WHERE credits > 0')
  const inactiveWithCredits = usersWithCredits.filter(u => !u.last_generation_at || (Date.now() - new Date(u.last_generation_at).getTime()) > 5*24*3600*1000).length

  // expiredUsers
  const [expiredRows] = await pool.query('SELECT count(*) as c FROM users WHERE credits=0 AND credit_expires_at IS NOT NULL AND credit_expires_at < NOW()')

  return {
    users: userRows[0].c,
    gens: genRows[0].c,
    pend: pendRows[0].c,
    sales: salesRows[0].c,
    buyers: buyerRows[0].c,
    activeCredits: activeCreditRows[0].c,
    inactiveWithCredits,
    expiredUsers: expiredRows[0].c
  }
}

async function createProduct(payload) {
  const id = uuid()
  const obj = {
    _id: id,
    title: payload.title || '',
    text: payload.text || '',
    price: payload.price || '',
    file: payload.file || '',
    created_at: new Date()
  }
  await pool.query('INSERT INTO products (_id, title, text, price, file, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [obj._id, obj.title, obj.text, obj.price, obj.file, obj.created_at])
  return obj
}

async function listProducts() {
  const [rows] = await pool.query('SELECT * FROM products ORDER BY created_at DESC')
  return rows
}

async function deleteProduct(id) {
  await pool.query('DELETE FROM products WHERE _id=?', [id])
}

async function markFreeCreditClaimedByTg(tgId) {
  await pool.query('UPDATE users SET free_credit_claimed=1 WHERE tg_id=?', [tgId])
}

module.exports = {
  init,
  getUserByTgId, upsertUser, setUserVoice, addCredits, removeCredits, addCreditsByTg, removeCreditsByTg,
  consumeCredit, expireIfPast, enforceExpiryByTg, listVoices, setVoices, setVoiceEnabled, addVoice, removeVoice,
  createPlan, listPlans, setPlanActive, getPlanById, deletePlan, setAwaitingPlan, clearAwaitingPlan,
  setAwaitingMethod, clearAwaitingMethod, listUsers, getUserById, getUserInternalIdByTg, pendingPayments,
  allPayments, listPaymentsByUser, listPaymentsByUserTg, createPayment, updatePaymentStatus, getPaymentById,
  recordGeneration, touchUserGenerationById, listGenerationsByUser, listGenerationsByUserTg, setSetting,
  getSetting, setPaymentMethods, getPaymentMethods, setPaymentQRCodes, getPaymentQRCodes, setUserBlocked,
  setUserBlockedByTg, stats, createProduct, listProducts, deleteProduct, markFreeCreditClaimedByTg
}
