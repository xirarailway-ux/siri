const axios = require('axios')
const { v4: uuidv4 } = require('uuid')
const { elevenApiKey } = require('./config')
const db = require('./db')
async function apiKey() { const k = await db.getSetting('eleven_api_key'); return k || elevenApiKey }
function extractMsg(e) {
  try {
    if (e.response && e.response.data) {
      let d = e.response.data
      if (Buffer.isBuffer(d)) {
        try { d = JSON.parse(d.toString('utf8')) } catch (_) { d = d.toString('utf8') }
      }
      if (typeof d === 'string') return d
      return d.detail?.message || d.message || JSON.stringify(d)
    }
  } catch (_) {}
  return e.message || 'Request failed'
}
function normalizeFormat(fmt) { if (!fmt) return 'opus_48000_64'; const f = String(fmt).toLowerCase(); if (f === 'ogg_64' || f === 'ogg') return 'opus_48000_64'; return fmt }
async function modelConfig() {
  const model_id = (await db.getSetting('tts_model_id')) || 'eleven_v3'
  const output_format = normalizeFormat((await db.getSetting('tts_output_format')) || 'opus_48000_64')
  const style = parseFloat((await db.getSetting('tts_style')) || '0')
  const stability = parseFloat((await db.getSetting('tts_stability')) || '0.5')
  const similarity_boost = parseFloat((await db.getSetting('tts_similarity_boost')) || '0.5')
  let use_speaker_boost = ((await db.getSetting('tts_use_speaker_boost')) || '0') === '1'
  if (String(model_id).includes('eleven_v3')) use_speaker_boost = false
  return { model_id, output_format, voice_settings: { style, stability, similarity_boost, use_speaker_boost } }
}
async function listVoices() {
  const key = await apiKey()
  if (!key) throw new Error('ElevenLabs API key missing')
  const res = await axios.get('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } })
  return (res.data.voices || []).map(v => ({ voice_id: v.voice_id || v.id, name: v.name }))
}
async function synthesize(voiceId, text) {
  const key = await apiKey()
  if (!key) throw new Error('ElevenLabs API key missing')
  const { model_id, output_format, voice_settings } = await modelConfig()
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${encodeURIComponent(output_format)}`
  const body = { text, model_id, voice_settings }
  let res
  try {
    res = await axios.post(url, body, { headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, responseType: 'arraybuffer' })
  } catch (e) {
    throw new Error(extractMsg(e))
  }
  const ext = (output_format.startsWith('opus') || output_format.startsWith('ogg')) ? '.ogg' : (output_format.startsWith('mp3') ? '.mp3' : '.wav')
  const filename = uuidv4() + ext
  return { buffer: res.data, filename }
}
module.exports = { listVoices, synthesize }
