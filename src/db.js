const fs = require('fs')
const path = require('path')
const { v4: uuid } = require('uuid')
const dir = path.join(__dirname, '..', 'data')
const file = path.join(dir, 'file.db')
function ensure() {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ users: [], voices: [], plans: [], payments: [], generations: [], settings: {} }, null, 2))
}
ensure()
function read() { return JSON.parse(fs.readFileSync(file, 'utf-8')) }
function write(data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)) }
async function getUserByTgId(tgId) { const d = read(); return d.users.find(u => u.tg_id === tgId) || null }
async function upsertUser(profile) {
  const d = read()
  const idx = d.users.findIndex(u => u.tg_id === profile.tg_id)
  if (idx >= 0) {
    d.users[idx] = { ...d.users[idx], username: profile.username, first_name: profile.first_name, last_name: profile.last_name }
  } else {
    d.users.push({ _id: uuid(), tg_id: profile.tg_id, username: profile.username, first_name: profile.first_name, last_name: profile.last_name, credits: 0, is_blocked: 0, created_at: new Date().toISOString(), credit_expires_at: null, last_generation_at: null, free_credit_claimed: 0 })
  }
  write(d)
  return getUserByTgId(profile.tg_id)
}
async function setUserVoice(tgId, voiceId) { const d = read(); const u = d.users.find(u => u.tg_id === tgId); if (u) { u.selected_voice_id = voiceId; write(d) } }
async function addCredits(userId, amount, valid_days) { const d = read(); const u = d.users.find(u => u._id === userId); if (u) { u.credits = (u.credits || 0) + amount; if (valid_days && valid_days > 0) { const dt = new Date(); dt.setDate(dt.getDate() + valid_days); u.credit_expires_at = dt.toISOString() } write(d) } }
async function removeCredits(userId, amount) { const d = read(); const u = d.users.find(u => u._id === userId); if (u) { const next = (u.credits || 0) - amount; u.credits = next < 0 ? 0 : next; if (u.credits === 0) { u.credit_expires_at = new Date().toISOString() } write(d) } }
async function addCreditsByTg(tgId, amount, valid_days) { const d = read(); const u = d.users.find(u => u.tg_id === tgId); if (u) { u.credits = (u.credits || 0) + amount; if (valid_days && valid_days > 0) { const dt = new Date(); dt.setDate(dt.getDate() + valid_days); u.credit_expires_at = dt.toISOString() } write(d) } }
async function removeCreditsByTg(tgId, amount) { const d = read(); const u = d.users.find(u => u.tg_id === tgId); if (u) { const next = (u.credits || 0) - amount; u.credits = next < 0 ? 0 : next; if (u.credits === 0) { u.credit_expires_at = new Date().toISOString() } write(d) } }
async function consumeCredit(userId) { const d = read(); const u = d.users.find(u => u._id === userId); if (u && u.credits > 0) { u.credits -= 1; if (u.credits === 0) { u.credit_expires_at = new Date().toISOString() } write(d) } }
async function expireIfPast(user) { if (user && user.credit_expires_at && new Date(user.credit_expires_at).getTime() < Date.now()) { user.credits = 0; return true } return false }
async function enforceExpiryByTg(tgId) { const d = read(); const u = d.users.find(u=>u.tg_id===tgId); if (u && u.credit_expires_at && new Date(u.credit_expires_at).getTime() < Date.now() && (u.credits||0)>0) { u.credits = 0; write(d); return true } return false }
async function listVoices(enabledOnly=true) { const d = read(); return (enabledOnly ? d.voices.filter(v => v.enabled === 1) : d.voices) }
async function setVoices(vs) { const d = read(); vs.forEach(v => { const i = d.voices.findIndex(x => x.voice_id === v.voice_id); if (i >= 0) d.voices[i] = { ...d.voices[i], name: v.name, enabled: 1 }; else d.voices.push({ voice_id: v.voice_id, name: v.name, enabled: 1 }) }); write(d) }
async function setVoiceEnabled(voiceId, enabled) { const d = read(); const v = d.voices.find(v => v.voice_id === voiceId); if (v) { v.enabled = enabled ? 1 : 0; write(d) } }
async function addVoice(voice_id, name) { const d = read(); if (!d.voices.find(v=>v.voice_id===voice_id)) { d.voices.push({ voice_id, name, enabled: 1 }); write(d) } }
async function removeVoice(voice_id) { const d = read(); d.voices = d.voices.filter(v=>v.voice_id!==voice_id); write(d) }
async function createPlan(name, credits, price, valid_days) { const d = read(); d.plans.push({ _id: uuid(), name, credits, price, valid_days: valid_days || 0, is_active: 1 }); write(d) }
async function listPlans(activeOnly=true) { const d = read(); return activeOnly ? d.plans.filter(p => p.is_active === 1) : d.plans }
async function setPlanActive(id, active) { const d = read(); const p = d.plans.find(p => p._id === id); if (p) { p.is_active = active ? 1 : 0; write(d) } }
async function getPlanById(id) { const d = read(); return d.plans.find(p => p._id === id) || null }
async function deletePlan(id) { const d = read(); d.plans = d.plans.filter(p=>p._id!==id); write(d) }
async function setAwaitingPlan(userId, planId) { const d = read(); const u = d.users.find(u => u._id === userId); if (u) { u.awaiting_plan_id = planId; write(d) } }
async function clearAwaitingPlan(userId) { const d = read(); const u = d.users.find(u => u._id === userId); if (u) { delete u.awaiting_plan_id; write(d) } }
async function setAwaitingMethod(userId, method) { const d = read(); const u = d.users.find(u => u._id === userId); if (u) { u.awaiting_method = method; write(d) } }
async function clearAwaitingMethod(userId) { const d = read(); const u = d.users.find(u => u._id === userId); if (u) { delete u.awaiting_method; write(d) } }
async function listUsers() { const d = read(); return d.users.sort((a,b)=> String(b.created_at).localeCompare(String(a.created_at))) }
async function getUserById(id) { const d = read(); return d.users.find(u=>u._id===id) || null }
async function getUserInternalIdByTg(tgId) { const d = read(); const u = d.users.find(u=>u.tg_id===tgId); return u ? u._id : null }
async function pendingPayments() { const d = read(); const pend = d.payments.filter(p => p.status === 'pending').sort((a,b)=> String(b.created_at).localeCompare(String(a.created_at))); return pend.map(p => ({ ...p, username: (d.users.find(u=>u._id===p.user_id)||{}).username, plan_name: (d.plans.find(pl=>pl._id===p.plan_id)||{}).name })) }
async function allPayments() { const d = read(); const all = d.payments.sort((a,b)=> String(b.created_at).localeCompare(String(a.created_at))); return all.map(p => ({ ...p, username: (d.users.find(u=>u._id===p.user_id)||{}).username, plan_name: (d.plans.find(pl=>pl._id===p.plan_id)||{}).name })) }
async function listPaymentsByUser(userId) { const d = read(); const arr = d.payments.filter(p=>p.user_id===userId).sort((a,b)=> String(b.created_at).localeCompare(String(a.created_at))); return arr.map(p => ({ ...p, plan_name: (d.plans.find(pl=>pl._id===p.plan_id)||{}).name })) }
async function listPaymentsByUserTg(tgId) { const id = await getUserInternalIdByTg(tgId); if (!id) return []; return listPaymentsByUser(id) }
async function createPayment(userId, planId, screenshotPath, method) { const d = read(); const obj = { _id: uuid(), user_id: userId, plan_id: planId, method: method || '', status: 'pending', screenshot_path: screenshotPath, created_at: new Date().toISOString() }; d.payments.push(obj); write(d); return obj }
async function updatePaymentStatus(id, status, adminId) { const d = read(); const p = d.payments.find(p => p._id === id); if (p) { p.status = status; p.approved_at = new Date().toISOString(); p.admin_id = adminId || null; write(d) } }
async function getPaymentById(id) { const d = read(); return d.payments.find(p => p._id === id) || null }
async function recordGeneration(userId, voiceId, textLength, audioPath) { const d = read(); d.generations.push({ _id: uuid(), user_id: userId, voice_id: voiceId, text_length: textLength, audio_path: audioPath, created_at: new Date().toISOString() }); write(d) }
async function touchUserGenerationById(userId) { const d = read(); const u = d.users.find(u=>u._id===userId); if (u) { u.last_generation_at = new Date().toISOString(); write(d) } }
async function listGenerationsByUser(userId) { const d = read(); return (d.generations||[]).filter(g=>g.user_id===userId).sort((a,b)=> String(b.created_at).localeCompare(String(a.created_at))) }
async function listGenerationsByUserTg(tgId) { const id = await getUserInternalIdByTg(tgId); if (!id) return []; return listGenerationsByUser(id) }
async function setSetting(key, value) { const d = read(); d.settings[key] = value; write(d) }
async function getSetting(key) { const d = read(); return d.settings[key] || null }
async function setPaymentMethods(obj) { await setSetting('payment_methods', JSON.stringify(obj||{})) }
async function getPaymentMethods() { const raw = await getSetting('payment_methods'); try { return raw ? JSON.parse(raw) : {} } catch (_) { return {} } }
async function setPaymentQRCodes(obj) { await setSetting('payment_qr', JSON.stringify(obj||{})) }
async function getPaymentQRCodes() { const raw = await getSetting('payment_qr'); try { return raw ? JSON.parse(raw) : {} } catch (_) { return {} } }
async function setUserBlocked(id, blocked) { const d = read(); const u = d.users.find(u => u._id === id); if (u) { u.is_blocked = blocked ? 1 : 0; write(d) } }
async function setUserBlockedByTg(tgId, blocked) { const d = read(); const u = d.users.find(u => u.tg_id === tgId); if (u) { u.is_blocked = blocked ? 1 : 0; write(d) } }
async function stats() { const d = read(); const sales = d.payments.filter(p=>p.status==='approved').length; const buyers = new Set(d.payments.filter(p=>p.status==='approved').map(p=>p.user_id)).size; const activeCredits = d.users.filter(u=> (u.credits||0) > 0).length; const inactiveWithCredits = d.users.filter(u=> (u.credits||0) > 0 && (!u.last_generation_at || (Date.now() - new Date(u.last_generation_at).getTime()) > 5*24*3600*1000)).length; const expiredUsers = d.users.filter(u=> (u.credits||0) === 0 && u.credit_expires_at && new Date(u.credit_expires_at).getTime() < Date.now()).length; return { users: d.users.length, gens: d.generations.length, pend: d.payments.filter(p=>p.status==='pending').length, sales, buyers, activeCredits, inactiveWithCredits, expiredUsers } }
async function createProduct(payload) { const d = read(); const obj = { _id: uuid(), title: payload.title || '', text: payload.text || '', price: payload.price || '', file: payload.file || '', created_at: new Date().toISOString() }; d.products = d.products || []; d.products.push(obj); write(d); return obj }
async function listProducts() { const d = read(); d.products = d.products || []; return d.products.sort((a,b)=> String(b.created_at).localeCompare(String(a.created_at))) }
async function deleteProduct(id) { const d = read(); d.products = (d.products||[]).filter(p=>p._id!==id); write(d) }
async function markFreeCreditClaimedByTg(tgId) { const d = read(); const u = d.users.find(u=>u.tg_id===tgId); if (u) { u.free_credit_claimed = 1; write(d) } }
module.exports = { getUserByTgId, upsertUser, setUserVoice, addCredits, removeCredits, addCreditsByTg, removeCreditsByTg, consumeCredit, expireIfPast, enforceExpiryByTg, listVoices, setVoices, setVoiceEnabled, addVoice, removeVoice, createPlan, listPlans, setPlanActive, getPlanById, deletePlan, setAwaitingPlan, clearAwaitingPlan, setAwaitingMethod, clearAwaitingMethod, listUsers, getUserById, getUserInternalIdByTg, pendingPayments, allPayments, listPaymentsByUser, listPaymentsByUserTg, createPayment, updatePaymentStatus, getPaymentById, recordGeneration, touchUserGenerationById, listGenerationsByUser, listGenerationsByUserTg, setSetting, getSetting, setPaymentMethods, getPaymentMethods, setPaymentQRCodes, getPaymentQRCodes, setUserBlocked, setUserBlockedByTg, stats, createProduct, listProducts, deleteProduct, markFreeCreditClaimedByTg }
