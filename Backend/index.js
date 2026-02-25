/* eslint-env node */

import express from 'express';
import cors from 'cors';
import yahooFinance from 'yahoo-finance2';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

// =====================================================
// 🔒 Security Imports (V2, V6)
// =====================================================
// helmet: เพิ่ม HTTP Security Headers อัตโนมัติ เช่น
//   - Content-Security-Policy (ป้องกัน XSS)
//   - Strict-Transport-Security (บังคับ HTTPS)
//   - X-Frame-Options (ป้องกัน Clickjacking)
//   - X-Content-Type-Options (ป้องกัน MIME Sniffing)
// อ้างอิง: OWASP A05:2021 - Security Misconfiguration
import helmet from 'helmet';

// express-rate-limit: จำกัดจำนวน Request ต่อ IP ต่อช่วงเวลา
// ป้องกัน:
//   - DDoS / Brute-force Attack
//   - API Abuse (ดูดข้อมูลจำนวนมาก)
//   - Yahoo/TwelveData API ถูก rate-limit เพราะเราส่ง request มากเกินไป
// อ้างอิง: OWASP A04:2021 - Insecure Design
import rateLimit from 'express-rate-limit';


// Import the custom env loader
import { loadEnv } from './envLoader.js';
// Import Yahoo Direct Fallback
import { fetchYahooDirect, fetchYahooDirectRaw } from './yahooDirect.js';

// Suppress specific Yahoo Finance warnings
yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);

// Get the directory where this script is located
const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);

// Load .env from the same directory as this script (Backend folder)
const envPath = path.join(currentDirPath, '.env');
loadEnv(envPath);


// ======================================================
// === Section 1: Configuration & Constants           ===
// ======================================================

const PORT = process.env.PORT || 7860;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour for general data
const FX_CACHE_TTL = 15 * 60 * 1000; // 15 minutes for Forex rates (more frequent update)
const BLOCK_DURATION = 1 * 1000; // 1 second
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ======================================================
// === Section 2: Cache & Circuit Breaker             ===
// ======================================================

const CACHE_FILE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stock_data_cache.json');

const cacheManager = {
  cache: new Map(),

  load() {
    try {
      if (fs.existsSync(CACHE_FILE_PATH)) {
        const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
        const json = JSON.parse(raw);
        // Convert array/object back to Map
        for (const [key, val] of Object.entries(json)) {
          this.cache.set(key, val);
        }
        console.log(`[Cache] Loaded ${this.cache.size} items from disk.`);
      }
    } catch (err) {
      console.error('[Cache] Failed to load cache from disk:', err.message);
    }
  },

  save() {
    try {
      // Convert Map to Object
      const obj = Object.fromEntries(this.cache);
      fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(obj, null, 2), 'utf-8');
      // console.log('[Cache] Saved to disk.'); // Uncomment for debug
    } catch (err) {
      console.error('[Cache] Failed to save cache to disk:', err.message);
    }
  },

  get(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // Check specific TTL based on key type (Forex vs Stock)
    const ttl = key.startsWith('fx_') ? FX_CACHE_TTL : CACHE_TTL;

    // Check if timestamp exists and is valid
    if (cached.timestamp && (Date.now() - cached.timestamp < ttl)) {
      console.log(`[Cache] HIT for: ${key}`);
      return cached.data;
    }

    console.log(`[Cache] EXPIRED for: ${key}. Fetching fresh data...`);
    this.cache.delete(key);
    this.save(); // Sync after delete
    return null;
  },

  set(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
    this.save(); // Sync after set
  },
};

// Initialize Cache
cacheManager.load();

const circuitBreaker = {
  isBlocked: false,
  blockUntil: 0,

  trip() {
    const secs = Math.ceil(BLOCK_DURATION / 1000);
    console.error(`[Circuit Breaker] Tripped! Blocking requests for ${secs} seconds.`);
    this.isBlocked = true;
    this.blockUntil = Date.now() + BLOCK_DURATION;
  },

  check(res) {
    if (this.isBlocked) {
      if (Date.now() < this.blockUntil) {
        const remainingSecs = Math.ceil((this.blockUntil - Date.now()) / 1000);
        console.warn(`[Circuit Breaker] Request rejected. Blocked for ${remainingSecs} more seconds.`);
        res.status(503).json({
          error: `Service is temporarily unavailable due to rate limiting. Please try again in ${remainingSecs} seconds.`,
        });
        return true;
      }
      console.log('[Circuit Breaker] Re-opening the circuit.');
      this.isBlocked = false;
      this.blockUntil = 0;
    }
    return false;
  },
};

// ======================================================
// === Section 3: Helpers                             ===
// ======================================================

const normalizeTicker = (ticker) => ticker.trim().toUpperCase();

const buildTickerVariants = (raw) => {
  const t = normalizeTicker(raw);
  if (t.includes('.')) return [t];
  return [t, `${t}.BK`]; // Prioritize exact match, fallback to SET (.BK)
};

// Accept Date, ISO string, or numeric epoch (sec/ms) and normalize to `YYYY-MM-DD` in UTC
const toDateOnly = (value) => {
  let date = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    date = new Date(ms);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      if (/^\d+$/.test(trimmed)) {
        const ms = Number(trimmed) > 1e12 ? Number(trimmed) : Number(trimmed) * 1000;
        date = new Date(ms);
      } else {
        date = new Date(trimmed);
      }
    }
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildDateRange = (startDate, endDate, fallbackDays = 365) => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const period2 = endDate ? new Date(endDate) : new Date(today);
  if (Number.isNaN(period2.getTime())) throw new Error('Invalid endDate format.');
  if (period2 > today) period2.setTime(today.getTime());
  period2.setHours(23, 59, 59, 999);

  let period1;
  if (startDate) {
    period1 = new Date(startDate);
    if (Number.isNaN(period1.getTime())) throw new Error('Invalid startDate format.');
  } else {
    period1 = new Date(period2);
    period1.setDate(period1.getDate() - fallbackDays);
  }
  period1.setHours(0, 0, 0, 0);

  if (period1 > period2) throw new Error('Start date must be before end date.');
  return { period1, period2 };
};

const toDateObject = (value) => {
  const iso = toDateOnly(value);
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`);
};

const parseQuoteSeries = (quotes) =>
  (Array.isArray(quotes) ? quotes : [])
    .map((row) => {
      const rawDate = row?.date ?? row?.timestamp ?? null;
      const date = toDateObject(rawDate);
      const close = typeof row?.close === 'number' ? Number(row.close) : null;
      if (!date || close === null) return null;
      return {
        date,
        iso: date.toISOString(),
        close,
        volume: typeof row.volume === 'number' ? Number(row.volume) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

const findPriceForDate = (series, targetDate) => {
  if (!targetDate) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].date <= targetDate) {
      return series[i];
    }
  }
  return null;
};

// --- Twelve Data Helpers ---
const formatTwelveDataSymbol = (sym) => {
  // Use exact matching for Thai stocks
  if (sym.endsWith('.BK')) {
    return sym.replace('.BK', ':SET');
  }

  // If user deliberately explicitly typed :SET, assume they know what they are doing
  if (sym.includes(':SET')) return sym;

  // IMPORTANT: Do NOT default to appending :SET for everything.
  // Assume generic symbols (e.g., "NVDA", "AAPL") are US market (NASDAQ/NYSE)
  return sym;
};

const fetchTwelveDataQuote = async (symbol) => {
  // Use 'demo' as fallback if no API key provided
  let apiKey = process.env.TWELVE_DATA_API_KEY;
  const isDemoFallback = !apiKey || apiKey === 'your_dummy_key_here';

  if (isDemoFallback) {
    apiKey = 'demo';
  }

  // 🔒 [V5] Security Fix: ไม่แสดง API Key (แม้บางส่วน) ใน logs
  // ปัญหาเดิม: แสดง 4 ตัวแรกของ API Key → Attacker ใช้ลด search space ในการ brute-force
  // แก้ไข: แสดงแค่สถานะ (configured/demo) โดยไม่เปิดเผยค่าจริง
  // อ้างอิง: OWASP A09:2021 - Security Logging and Monitoring Failures
  const keyStatus = apiKey === 'demo' ? 'demo (fallback)' : 'configured';
  console.log(`[TwelveData] API Key status: ${keyStatus}`);

  // Adjust symbol for TwelveData format (Thai stocks need :SET)
  const tdSymbol = formatTwelveDataSymbol(symbol);

  try {
    const url = `https://api.twelvedata.com/quote?symbol=${tdSymbol}&apikey=${apiKey}`;
    console.log(`[TwelveData] Fetching quote for ${symbol}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP Status ${res.status}`);
    const data = await res.json();

    // TwelveData returns { status: "error" } on failure
    if (data.status === 'error') {
      throw new Error(data.message || 'TwelveData API Error');
    }

    // Extract price - TwelveData returns 'close' as previous close, 'price' might not exist
    // Use 'close' as current price indicator (previous close is most recent)
    const price = Number(data.close) || Number(data.previous_close) || 0;

    if (!price || price <= 0) {
      console.warn(`[TwelveData] Invalid price for ${symbol} (tdSymbol=${tdSymbol}):`, data);
      return null;
    }

    console.log(`[TwelveData] Success for ${symbol} (tdSymbol=${tdSymbol}): ${price} ${data.currency}`);
    return {
      symbol: data.symbol,
      longName: data.name || data.symbol,
      currentPrice: price,
      currency: data.currency,
      timestamp: new Date().toISOString(),
      provider: 'TwelveData'
    };

  } catch (error) {
    console.error(`[TwelveData] Quote failed for ${symbol} (tdSymbol=${tdSymbol}):`, error.message);
    return null;
  }
};

const fetchTwelveDataHistory = async (symbol, period1, period2) => {
  // Use 'demo' as fallback if no API key provided
  let apiKey = process.env.TWELVE_DATA_API_KEY;
  const isDemoFallback = !apiKey || apiKey === 'your_dummy_key_here';

  if (isDemoFallback) {
    apiKey = 'demo';
  }

  // 🔒 [V5] Security Fix: ซ่อน API Key จาก logs (เหมือน fetchTwelveDataQuote)
  const keyStatus = apiKey === 'demo' ? 'demo (fallback)' : 'configured';
  console.log(`[TwelveData] History Request - API Key status: ${keyStatus}`);
  // Adjust symbol for TwelveData format (Thai stocks need :SET)
  const tdSymbol = formatTwelveDataSymbol(symbol);

  try {
    // interval=1day is standard
    // start_date, end_date format: YYYY-MM-DD
    const start = toDateOnly(period1);
    const end = toDateOnly(period2);

    const url = `https://api.twelvedata.com/time_series?symbol=${tdSymbol}&interval=1day&start_date=${start}&end_date=${end}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP Status ${res.status}`);
    const data = await res.json();

    if (data.code && data.code !== 200) {
      throw new Error(data.message || 'API Error');
    }

    if (!Array.isArray(data.values)) return [];

    // Map format: { date, close: number, volume: number }
    // Twelve Data returns newest first, so we reverse to be chronological if needed
    const history = data.values.map(item => ({
      date: new Date(item.datetime).toISOString(),
      close: Number(item.close),
      volume: Number(item.volume)
    })).sort((a, b) => new Date(a.date) - new Date(b.date));

    // TwelveData provides currency in the meta object
    return {
      history,
      currency: data.meta?.currency || 'USD' // Fallback to USD if missing (mostly US stocks on free tier)
    };

  } catch (error) {
    console.error(`[TwelveData] History failed for ${symbol} (tdSymbol=${tdSymbol}):`, error.message);
    return null;
  }
};

// --- Currency Helper: Fetch Specific FX Rate ---
const fetchForexRate = async (pairSymbol) => {
  const cacheKey = `fx_${pairSymbol}`;
  const cached = cacheManager.get(cacheKey);
  if (cached !== null) return cached;

  try {
    const quote = await yahooFinance.quote(pairSymbol, { fields: ['regularMarketPrice'] });
    const price = Number(quote?.regularMarketPrice);
    if (Number.isFinite(price) && price > 0) {
      console.log(`[FX] Fetched ${pairSymbol}: ${price}`);
      cacheManager.set(cacheKey, price);
      return price;
    }
  } catch (error) {
    console.warn(`[FX] Library failed for ${pairSymbol} (${error.message}). Trying Direct...`);

    // Fallback for Forex: Use Yahoo Direct Raw to get meta.regularMarketPrice
    // Even a 1-day range will have the current price in the meta object
    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
      const result = await fetchYahooDirectRaw(pairSymbol, yesterday, now, '1d');
      const price = Number(result?.meta?.regularMarketPrice);

      if (Number.isFinite(price) && price > 0) {
        console.log(`[FX Direct] Success for ${pairSymbol}: ${price}`);
        cacheManager.set(cacheKey, price);
        return price;
      }
    } catch (directErr) {
      console.warn(`[FX Direct] Fallback failed for ${pairSymbol}:`, directErr.message);
    }
  }
  return null;
};

const getFxRate = async (fromCurrency, toCurrency) => {
  if (!fromCurrency || !toCurrency) return null;
  if (fromCurrency === toCurrency) return 1;

  // Direct Pair: e.g. THB=X (USD -> THB) or THBUSD=X
  // Yahoo Finance convention for USD base: "THB=X" means 1 USD = x.xx THB

  // Case 1: USD -> Target (e.g. USD -> THB)
  if (fromCurrency === 'USD') {
    const symbol = `${toCurrency}=X`; // e.g. THB=X
    return await fetchForexRate(symbol);
  }

  // Case 2: Target -> USD (e.g. THB -> USD)
  if (toCurrency === 'USD') {
    const symbol = `${fromCurrency}=X`; // e.g. THB=X (gives USD->THB)
    const rate = await fetchForexRate(symbol);
    return rate ? 1 / rate : null;
  }

  // Case 3: Cross Rate via USD (e.g. GBP -> THB)
  // GBP -> USD -> THB
  const toUsd = await getFxRate(fromCurrency, 'USD');
  const usdToTarget = await getFxRate('USD', toCurrency);

  if (toUsd && usdToTarget) {
    const crossRate = toUsd * usdToTarget;
    // Cache the calculated cross rate for performance
    cacheManager.set(`fx_${fromCurrency}${toCurrency}`, crossRate);
    return crossRate;
  }

  return null;
};

const enrichCurrency = async (events) => {
  // Identify all unique currencies in the dataset
  const uniqueCurrencies = new Set(
    events
      .map((event) => event.currency)
      .filter((code) => code && code !== 'THB') // We want to convert everything to THB eventually
  );

  // Pre-fetch/Calculate rates for all currencies involved
  // We specifically want to ensure we have USD -> THB available
  const usdThbRate = await getFxRate('USD', 'THB');

  const conversionMatrix = new Map();

  // Always add USD conversion capability if possible
  if (usdThbRate) {
    conversionMatrix.set('USD', { toThb: usdThbRate, toUsd: 1 });
  }

  // Process other currencies
  await Promise.all([...uniqueCurrencies].map(async (code) => {
    if (code === 'USD') return; // Already handled

    const [toUsd, toThb] = await Promise.all([
      getFxRate(code, 'USD'),
      getFxRate(code, 'THB')
    ]);

    conversionMatrix.set(code, { toUsd, toThb });
  }));

  // Map events with conversions
  return events.map((event) => {
    let amountUSD = null;
    let amountTHB = null;
    let priceUSD = null;
    let priceTHB = null;

    const sourceCurrency = event.currency;
    const rates = conversionMatrix.get(sourceCurrency) || {};

    // --- Amount Conversions ---
    if (Number.isFinite(event.amountPerShare)) {
      if (sourceCurrency === 'USD') {
        amountUSD = event.amountPerShare;
        if (usdThbRate) amountTHB = event.amountPerShare * usdThbRate;
      } else if (sourceCurrency === 'THB') {
        amountTHB = event.amountPerShare;
        // THB -> USD (inverse of USD->THB)
        if (usdThbRate) amountUSD = event.amountPerShare / usdThbRate;
      } else {
        // Other Currency
        if (rates.toUsd) amountUSD = event.amountPerShare * rates.toUsd;
        if (rates.toThb) amountTHB = event.amountPerShare * rates.toThb;
      }
    }

    // --- Price Conversions ---
    if (Number.isFinite(event.priceAtEvent)) {
      if (sourceCurrency === 'USD') {
        priceUSD = event.priceAtEvent;
        if (usdThbRate) priceTHB = event.priceAtEvent * usdThbRate;
      } else if (sourceCurrency === 'THB') {
        priceTHB = event.priceAtEvent;
        if (usdThbRate) priceUSD = event.priceAtEvent / usdThbRate;
      } else {
        if (rates.toUsd) priceUSD = event.priceAtEvent * rates.toUsd;
        if (rates.toThb) priceTHB = event.priceAtEvent * rates.toThb;
      }
    }

    return {
      ...event,
      amountUSD: amountUSD ? Number(amountUSD.toFixed(4)) : null,
      amountTHB: amountTHB ? Number(amountTHB.toFixed(4)) : null,
      priceUSD: priceUSD ? Number(priceUSD.toFixed(4)) : null,
      priceTHB: priceTHB ? Number(priceTHB.toFixed(4)) : null,
      // Include exchange rate used for reference
      fxRateUsed: sourceCurrency === 'USD' ? usdThbRate : (rates.toThb || null)
    };
  });
};

// ======================================================
// === Section 4: Express App                         ===
// ======================================================

const app = express();

// =====================================================
// 🔒 [V6] Security Headers — Helmet Middleware
// =====================================================
// Helmet ตั้งค่า HTTP Response Headers โดยอัตโนมัติ:
//
// 1. Content-Security-Policy (CSP):
//    - ป้องกัน XSS (Cross-Site Scripting) โดยควบคุมว่า Browser
//      อนุญาตให้โหลด script/style/image จากแหล่งไหนได้บ้าง
//    - defaultSrc: ["'self'"] → อนุญาตเฉพาะจาก domain ตัวเอง
//    - scriptSrc: ["'self'"] → ไม่ยอมให้รัน inline <script>
//    - styleSrc: ต้องมี 'unsafe-inline' เพราะ React ใช้ inline styles
//    - connectSrc: อนุญาตให้ fetch ไปยัง TwelveData / Yahoo API เท่านั้น
//
// 2. Strict-Transport-Security (HSTS):
//    - บังคับให้ Browser ใช้ HTTPS เสมอ (ป้องกัน Man-in-the-Middle)
//    - maxAge: 1 ปี → Browser จำไว้ 1 ปีว่าเว็บนี้ต้องใช้ HTTPS
//
// 3. X-Frame-Options: DENY
//    - ป้องกัน Clickjacking → ไม่ให้เว็บอื่นใส่เราใน <iframe>
//
// 4. X-Content-Type-Options: nosniff
//    - ป้องกัน MIME Sniffing → Browser ไม่เดา file type เอง
//
// อ้างอิง: OWASP A05:2021 - Security Misconfiguration
// อ้างอิง: https://helmetjs.github.io/
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],                          // โหลด resource จาก domain ตัวเองเท่านั้น
      scriptSrc: ["'self'"],                            // รัน script จาก domain ตัวเองเท่านั้น
      styleSrc: ["'self'", "'unsafe-inline'"],          // อนุญาต inline styles (React จำเป็นต้องใช้)
      imgSrc: ["'self'", "data:", "https:"],            // อนุญาต images จาก self, data URI, HTTPS
      connectSrc: [
        "'self'",                                       // API calls ไปที่ตัวเอง
        "https://api.twelvedata.com",                   // TwelveData API
        "https://query1.finance.yahoo.com"              // Yahoo Finance API
      ],
    },
  },
  crossOriginEmbedderPolicy: false,   // ปิดเพื่อไม่ให้ block Recharts SVG rendering
  hsts: {
    maxAge: 31536000,                  // บังคับ HTTPS นาน 1 ปี (31,536,000 วินาที)
    includeSubDomains: true,           // รวม subdomain ด้วย
    preload: true,                     // ลงทะเบียน HSTS Preload List ได้
  },
}));

// =====================================================
// 🔒 Trust Proxy Setting (สำหรับ Render.com)
// =====================================================
// Render.com ใช้ Reverse Proxy หน้า Express
// ถ้าไม่ตั้งค่านี้ → req.ip จะได้ IP ของ Proxy (ไม่ใช่ IP ผู้ใช้จริง)
// ส่งผลให้ Rate Limiter ไม่ทำงานถูกต้อง (นับทุกคนเป็น IP เดียวกัน)
// ค่า 1 = trust proxy ตัวแรก (Render.com reverse proxy)
app.set('trust proxy', 1);

// =====================================================
// 🔒 [V1] CORS Whitelist — เฉพาะ Domain ที่อนุญาตเท่านั้น
// =====================================================
// ปัญหาเดิม: app.use(cors()) → เปิดให้ทุกเว็บไซต์เรียก API ได้
// ความเสี่ยง: เว็บมิจฉาชีพสามารถดึงข้อมูลจาก API เราไปแสดงเป็นของตัวเอง
// ถ้ามี Login ในอนาคต → Attacker สามารถขโมย Session/Cookie ผ่าน CORS ได้
// แก้ไข: อนุญาตเฉพาะ domain ที่เรากำหนด
// อ้างอิง: CWE-942 (Overly Permissive CORS Policy)
const allowedOrigins = [
  'http://localhost:5173',          // Vite Dev Server (development)
  'http://localhost:7860',          // Backend Dev (development)
  'https://stock-calculator-yaf0.onrender.com', // Backend URL
  'https://stock-calculator-murex.vercel.app', // Frontend URL (Vercel)
];

app.use(cors({
  origin: function (origin, callback) {
    // อนุญาต requests ที่ไม่มี origin (เช่น mobile apps, curl, Postman)
    // — เพราะ tools เหล่านี้ไม่ส่ง Origin header
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // ❌ Domain ไม่อยู่ใน whitelist → ไม่ส่ง CORS headers กลับไป
    // Browser จะ block response ฝั่ง client เอง (ไม่ throw error เข้า Global Error Handler)
    // Log ไว้เพื่อ debug ว่า origin ไหนที่มาเรียกแล้วถูก block
    console.warn(`[CORS] Blocked request from origin: ${origin}`);
    return callback(null, false);
  },
  methods: ['GET'],          // จำกัดเฉพาะ GET (API นี้ไม่มี POST/PUT/DELETE)
  credentials: false,        // ไม่ต้องส่ง cookies (ไม่มี Login)
  optionsSuccessStatus: 200, // สำหรับ Legacy browsers ที่ไม่รองรับ 204
}));

// =====================================================
// 🔒 [V2] Rate Limiting — จำกัดจำนวน Requests ต่อ IP
// =====================================================
// ปัญหาเดิม: ไม่มี Rate Limit → ใครก็ส่ง request กี่พันครั้งก็ได้
// ความเสี่ยง:
//   1) DDoS → Server ล่ม, ผู้ใช้คนอื่นเข้าไม่ได้
//   2) Yahoo/TwelveData ban API Key ของเรา (ฝั่งเขามี rate limit)
//   3) Render.com คิดเงินเพิ่ม (ถ้า paid plan)
// แก้ไข: จำกัด 100 req / 15 นาที (ทั่วไป) + 30 req / 1 นาที (API routes)
//
// การคำนวณ Threshold:
//   ผู้ใช้เปิดหน้าเว็บ = ~3-5 API calls (quote + history + dividends)
//   ค้นหุ้น 10 ตัวใน 15 นาที = 10 × 5 = 50 calls
//   Safety margin × 2 = 100 calls / 15 min → ผู้ใช้ปกติไม่มีทางโดน limit
//
// อ้างอิง: OWASP A04:2021 - Insecure Design

// --- Global Rate Limiter: ใช้กับทุก Route ---
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,    // กรอบเวลา 15 นาที
  max: 100,                     // สูงสุด 100 requests ต่อ IP ต่อ 15 นาที
  standardHeaders: true,        // ส่ง RateLimit-* headers กลับให้ Client รู้
  legacyHeaders: false,         // ไม่ส่ง X-RateLimit-* headers แบบเก่า
  message: {
    error: 'Too many requests from this IP. Please try again in 15 minutes.',
    retryAfter: 15              // แนะนำให้ Client รอ 15 นาที
  },
});

// --- API Rate Limiter: เข้มงวดกว่า สำหรับ routes ที่เรียก External API ---
// เหตุผล: /api/ routes ทุกตัวไปเรียก Yahoo/TwelveData
// ถ้าไม่จำกัด → API Key ของเราจะถูกฝั่ง Provider ban
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,     // กรอบเวลา 1 นาที
  max: 30,                      // สูงสุด 30 requests ต่อ IP ต่อนาที
  message: {
    error: 'API rate limit exceeded. Please slow down and try again in 1 minute.',
    retryAfter: 1
  },
});

// เปิดใช้งาน Rate Limiters
app.use(globalLimiter);           // ใช้กับทุก Route (รวม static files)
app.use('/api/', apiLimiter);     // ใช้เฉพาะ /api/* (เข้มงวดกว่า)

app.use(express.json());

// =====================================================
// 🔒 [V3] Debug Route — ซ่อนใน Production
// =====================================================
// ปัญหาเดิม: /api/debug/info เปิดให้ทุกคนเข้าดูได้ใน Production
// ความเสี่ยง: เปิดเผยข้อมูลภายใน (API Key status, Provider config)
//   → Attacker ใช้ข้อมูลนี้ในขั้น Reconnaissance ก่อนโจมตี
// แก้ไข: แสดง Debug route เฉพาะเมื่อ NODE_ENV !== 'production'
// วิธีตั้งค่าใน Render.com: Environment Variables → NODE_ENV = production
// อ้างอิง: OWASP A05:2021 - Security Misconfiguration
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/info', async (req, res) => {
    const apiKey = process.env.TWELVE_DATA_API_KEY || 'none';
    const isDemo = apiKey === 'demo';
    const maskedKey = isDemo ? 'demo' : (apiKey.length > 4 ? apiKey.substring(0, 4) + '...' : apiKey);

    const testSymbol = 'PTT';
    const tdSymbol = formatTwelveDataSymbol(testSymbol);

    let quoteResult = null;
    try {
      quoteResult = await fetchTwelveDataQuote(testSymbol);
    } catch (err) {
      quoteResult = { error: err.message };
    }

    res.json({
      apiKeyStatus: apiKey ? 'Present' : 'Missing',
      maskedKey,
      isDemo,
      tdSymbolTest: { input: testSymbol, output: tdSymbol },
      quoteTest: quoteResult
    });
  });
  console.log('[Server] 🔧 Debug route /api/debug/info enabled (development mode)');
} else {
  console.log('[Server] 🔒 Debug route /api/debug/info DISABLED (production mode)');
}

// NOTE: Removed global circuit breaker middleware - each route now handles fallback to TwelveData individually

// ======================================================
// === Section 5: Route Controllers                   ===
// ======================================================

// --- Controller: Get USD/THB Exchange Rate ---
const getUsdThbRate = async (req, res) => {
  try {
    const rate = await getFxRate('USD', 'THB');
    if (!rate) {
      return res.status(503).json({ error: 'Unable to fetch USD/THB rate at this time.' });
    }
    return res.json({
      currencyPair: 'USD/THB',
      rate: Number(rate.toFixed(4)),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Forex] Error fetching USD/THB:', error);
    return res.status(500).json({ error: 'Internal Server Error fetching Forex rate.' });
  }
};

const getStockQuote = async (req, res) => {
  const raw = req.params.ticker;
  const variants = buildTickerVariants(raw);

  const forceProvider = req.query.forceProvider; // Debug: ?forceProvider=twelvedata

  let lastError = null;
  for (const symbol of variants) {
    const cacheKey = `quote_${symbol}`;
    const cached = cacheManager.get(cacheKey);
    // If forcing provider, skip cache check
    if (cached && !forceProvider) return res.json(cached);

    // 1. Try Yahoo Finance (unless forced otherwise)
    if (forceProvider !== 'twelvedata') {
      try {
        const quote = await yahooFinance.quote(symbol, {
          fields: ['symbol', 'longName', 'regularMarketPrice', 'currency', 'regularMarketTime'],
        });

        if (!quote || !quote.symbol || !Number.isFinite(quote.regularMarketPrice)) {
          throw new Error(`Invalid Yahoo data for ${symbol}`);
        }

        const responseData = {
          symbol: quote.symbol,
          longName: quote.longName ?? null,
          currentPrice: Number(quote.regularMarketPrice.toFixed(2)),
          currency: quote.currency ?? null,
          timestamp: quote.regularMarketTime
            ? new Date(quote.regularMarketTime * 1000).toISOString()
            : null,
          provider: 'YahooFinance'
        };

        cacheManager.set(cacheKey, responseData);
        return res.json(responseData);
      } catch (error) {
        console.warn(`[Yahoo] Quote failed for ${symbol}:`, error.message);
        lastError = error;
      }
    }

    // 2. Try Twelve Data (Backup)
    // Only if Yahoo failed OR we forced it
    if (lastError || forceProvider === 'twelvedata') {
      console.log(`[Backup] Attempting Twelve Data for ${symbol}...`);
      const tdQuote = await fetchTwelveDataQuote(symbol);
      if (tdQuote) {
        tdQuote.currentPrice = Number(tdQuote.currentPrice.toFixed(2)); // Ensure format
        cacheManager.set(cacheKey, tdQuote);
        return res.json(tdQuote);
      }
    }
  }

  if (lastError?.status === 404) {
    return res.status(404).json({ error: `Ticker '${normalizeTicker(raw)}' not found.` });
  }
  return res.status(500).json({ error: 'Failed to fetch stock quote from all providers.' });
};

const getStockHistory = async (req, res) => {
  const raw = req.params.ticker;
  const variants = buildTickerVariants(raw);
  const { startDate, endDate } = req.query;

  let period1;
  let period2;
  try {
    ({ period1, period2 } = buildDateRange(startDate, endDate, 90));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const forceProvider = req.query.forceProvider;
  let lastError = null;

  for (const symbol of variants) {
    const cacheKey = `history_${symbol}_${startDate || '90d'}_${endDate || 'today'}`;
    const cached = cacheManager.get(cacheKey);
    if (cached && !forceProvider) return res.json(cached);

    // 1. Try Yahoo
    // 1. Try Yahoo
    if (forceProvider !== 'twelvedata') {
      try {
        const result = await yahooFinance.chart(symbol, {
          period1,
          period2,
          interval: '1d',
        });

        const history = parseQuoteSeries(result?.quotes || []);
        if (!history.length) {
          throw new Error('Empty history from Yahoo');
        }

        const historyData = history.map((row) => ({
          date: row.iso,
          close: row.close,
          volume: row.volume ?? null,
        }));

        // Extract currency from Yahoo Meta
        const currency = result.meta?.currency || 'USD';

        const responseObj = { history: historyData, currency };

        cacheManager.set(cacheKey, responseObj);
        return res.json(responseObj);
      } catch (error) {
        console.warn(`[Yahoo] Library failed for ${symbol} (${error.message}). Trying Direct Fetch...`);

        // 1.5 Try Yahoo Direct Fetch (mimic curl)
        try {
          const directResult = await fetchYahooDirect(symbol, period1, period2);
          if (directResult && directResult.history && directResult.history.length > 0) {
            console.log(`[Yahoo Direct] Success for ${symbol}`);
            const responseObj = {
              history: directResult.history,
              currency: directResult.currency || 'USD'
            };
            cacheManager.set(cacheKey, responseObj);
            return res.json(responseObj);
          }
        } catch (directErr) {
          console.warn(`[Yahoo Direct] Fallback failed for ${symbol}:`, directErr.message);
        }

        lastError = error;
      }
    }

    // 2. Try Twelve Data Fallback
    if (lastError || forceProvider === 'twelvedata') {
      console.log(`[Backup] Attempting Twelve Data History for ${symbol}...`);
      const tdResult = await fetchTwelveDataHistory(symbol, period1, period2);
      if (tdResult && tdResult.history && tdResult.history.length > 0) {
        const responseObj = {
          history: tdResult.history,
          currency: tdResult.currency
        };
        cacheManager.set(cacheKey, responseObj);
        return res.json(responseObj);
      }
    }
  }

  if (lastError?.status === 404) {
    return res.status(404).json({ error: `Ticker '${normalizeTicker(raw)}' not found.` });
  }
  return res.status(500).json({ error: 'Failed to fetch stock history from all providers.' });
};

const getDividendHistory = async (req, res) => {
  const raw = req.params.ticker;
  const variants = buildTickerVariants(raw);
  const { startDate, endDate } = req.query;

  let period1;
  let period2;
  try {
    ({ period1, period2 } = buildDateRange(startDate, endDate, 365 * 5));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let lastError = null;
  for (const symbol of variants) {
    const cacheKey = `dividends_${symbol}_${startDate || 'max'}_${endDate || 'today'}`;
    const cached = cacheManager.get(cacheKey);
    if (cached) return res.json(cached);

    let result;
    try {
      result = await yahooFinance.chart(symbol, {
        period1,
        period2,
        interval: '1d',
        events: 'div',
      });
    } catch (libErr) {
      console.warn(`[Yahoo] Library failed for dividends ${symbol}: ${libErr.message}. Trying Direct...`);
      try {
        result = await fetchYahooDirectRaw(symbol, period1, period2, '1d', 'div');
      } catch (directErr) {
        console.warn(`[Yahoo Direct] Dividend fallback failed: ${directErr.message}`);
      }
    }

    if (!result) {
      continue;
    }

    try {
      const dividendEvents = result?.events?.dividends;
      const dividendArray = dividendEvents ? Object.values(dividendEvents) : [];
      if (dividendArray.length === 0) {
        lastError = new Error(`No dividend data found for ticker: ${symbol}`);
        continue;
      }

      const quoteSeries = parseQuoteSeries(result?.quotes || []);
      const aggregateIssues = new Set();
      const processedEvents = [];
      let flaggedEvents = 0;

      for (const event of dividendArray) {
        const warnings = [];

        const eventDate = toDateObject(event.date ?? event.timestamp ?? null);

        if (!(eventDate instanceof Date) || Number.isNaN(eventDate.getTime())) {
          warnings.push('ไม่สามารถตีความวันที่ได้');
          aggregateIssues.add('พบข้อมูลปันผลที่ไม่สามารถตีความวันที่ได้');
        }

        const amountPerShare =
          typeof event.amount === 'number' && Number.isFinite(event.amount) ? Number(event.amount) : null;
        if (amountPerShare === null) {
          warnings.push('ไม่มีจำนวนปันผลต่อหุ้น');
          aggregateIssues.add('บางรายการไม่มีจำนวนปันผลต่อหุ้น');
        }

        const currency = event.currency || result?.meta?.currency || null;
        const withinRequestedRange = eventDate instanceof Date && eventDate >= period1 && eventDate <= period2;

        const priceInfo =
          eventDate instanceof Date && quoteSeries.length ? findPriceForDate(quoteSeries, eventDate) : null;

        let priceAtEvent = null;
        let priceDate = null;
        if (priceInfo) {
          priceAtEvent = priceInfo.close;
          priceDate = toDateOnly(priceInfo.date);
          if (priceInfo.date < eventDate) {
            warnings.push('ใช้ราคาปิดก่อนหน้าวันจ่ายปันผล');
            aggregateIssues.add('ต้องใช้ราคาปิดก่อนหน้าวันปันผลสำหรับบางรายการ');
          }
        } else {
          warnings.push('ไม่พบราคาปิดใกล้เคียง');
          aggregateIssues.add('บางรายการไม่มีราคาปิดให้คำนวณ Dividend Yield');
        }

        let yieldPercent = null;
        if (Number.isFinite(priceAtEvent) && Number.isFinite(amountPerShare) && priceAtEvent > 0) {
          yieldPercent = Number(((amountPerShare / priceAtEvent) * 100).toFixed(2));
          if (yieldPercent > 20) {
            warnings.push('Dividend Yield สูงผิดปกติ (>20%) กรุณาตรวจสอบข้อมูล');
            aggregateIssues.add('พบ Dividend Yield สูงกว่า 20% ในบางรายการ');
          }
        }

        if (warnings.length > 0) flaggedEvents += 1;

        processedEvents.push({
          date: toDateOnly(eventDate),
          withinRequestedRange,
          amountPerShare,
          currency,
          priceAtEvent: Number.isFinite(priceAtEvent) ? Number(priceAtEvent.toFixed(4)) : null,
          priceDate,
          yieldPercent,
          qualityWarnings: warnings,
          raw: event,
        });
      }

      // --- FX Rate Injection ---
      const enrichedEvents = await enrichCurrency(processedEvents);

      // Fetch current general USD/THB rate for reference in response meta
      const currentUsdThb = await getFxRate('USD', 'THB');

      const coverageEvents = enrichedEvents
        .filter((event) => event.withinRequestedRange && event.date)
        .map((event) => ({
          ...event,
          iso: event.date ? new Date(`${event.date}T00:00:00Z`).toISOString() : null,
        }))
        .filter((event) => event.iso);

      const sortedCoverage = [...coverageEvents].sort(
        (a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime(),
      );
      const actualStart = sortedCoverage[0]?.date ?? null;
      const actualEnd = sortedCoverage[sortedCoverage.length - 1]?.date ?? null;

      const actualRangeDays =
        actualStart && actualEnd
          ? Math.floor(
            (new Date(`${actualEnd}T00:00:00Z`).getTime() - new Date(`${actualStart}T00:00:00Z`).getTime()) /
            MS_PER_DAY,
          ) + 1
          : 0;
      const requestedRangeDays = Math.floor((period2 - period1) / MS_PER_DAY) + 1;
      const coverageRatio =
        requestedRangeDays > 0 && actualRangeDays > 0
          ? Number(Math.min(actualRangeDays / requestedRangeDays, 1).toFixed(3))
          : 0;

      if (flaggedEvents > 0) {
        aggregateIssues.add(`มี ${flaggedEvents} รายการที่มีคำเตือนเพิ่มเติม`);
      }

      const payload = {
        ticker: normalizeTicker(raw),
        resolvedTicker: symbol,
        currency: enrichedEvents[0]?.currency || result?.meta?.currency || null,
        meta: {
          currentUsdThbRate: currentUsdThb ? Number(currentUsdThb.toFixed(4)) : null,
          fxTimestamp: new Date().toISOString()
        },
        period: {
          start: toDateOnly(period1),
          end: toDateOnly(period2),
        },
        events: enrichedEvents.sort((a, b) => {
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1;
          if (!b.date) return -1;
          return new Date(`${b.date}T00:00:00Z`).getTime() - new Date(`${a.date}T00:00:00Z`).getTime();
        }),
        quality: {
          requestedRange: { start: toDateOnly(period1), end: toDateOnly(period2) },
          actualRange: { start: actualStart, end: actualEnd },
          requestedRangeDays,
          actualRangeDays,
          coverageRatio,
          invalidEventsDropped: 0,
          flaggedEvents,
          issues: Array.from(aggregateIssues),
        },
      };

      cacheManager.set(cacheKey, payload);
      return res.json(payload);
    } catch (error) {
      console.error(`[Fetch] Dividend error for ${symbol}:`, error.message);
      // SyntaxError typically means Yahoo is returning HTML (rate limit/block)
      // We do NOT trip the circuit breaker globally to avoid blocking other endpoints (quote/history) that might have fallbacks.
      if (error instanceof SyntaxError && error.message?.includes('Unexpected token')) {
        // Just log and continue to next symbol or error out for this specific request
        lastError = new Error('Yahoo API Rate Limit (HTML response)');
        continue;
      }
      if (error.status === 404) {
        lastError = error;
        continue;
      }
      lastError = error;
    }
  }

  if (lastError?.status === 404) {
    return res.status(404).json({ error: `Ticker '${normalizeTicker(raw)}' not found.` });
  }
  return res.status(500).json({ error: lastError?.message || 'Failed to fetch dividend history.' });
};

// ======================================================
// === Section 6: Routes                              ===
// ======================================================

// =====================================================
// 🔒 [V4] Input Validation Middleware
// =====================================================
// ปัญหาเดิม: ค่า ticker จาก URL ถูกนำไปใช้โดยไม่ตรวจสอบ
//   เช่น /api/stock/<script>alert(1)</script>
//   → อาจถูก reflect กลับใน error message (XSS)
//   → อาจทำให้ Yahoo/TwelveData API error (ส่ง request แปลกๆ)
//   → อาจเป็น Path Traversal: /api/stock/../../etc/passwd
//
// แก้ไข: ตรวจสอบ format ด้วย Regex ก่อนส่งต่อ
//   - อนุญาตเฉพาะ: A-Z, a-z, 0-9, จุด (.), ขีด (-)
//   - ความยาว 1-20 ตัวอักษร
//   - ครอบคลุม Ticker ทุกตลาด: AAPL, PTT.BK, 2222.SR, NESN.SW
// อ้างอิง: OWASP A03:2021 - Injection
// อ้างอิง: CWE-20 (Improper Input Validation)

const TICKER_REGEX = /^[A-Za-z0-9.\-]{1,20}$/;

const validateTicker = (req, res, next) => {
  const ticker = req.params.ticker;

  // ขั้น 1: ตรวจ format — ต้องตรง Regex เท่านั้น
  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return res.status(400).json({
      error: 'Invalid ticker format. Use 1-20 alphanumeric characters, dots, or hyphens only.'
    });
  }

  // ขั้น 2: Normalize — แปลงเป็นตัวพิมพ์ใหญ่ ป้องกัน case-sensitive bypass
  req.params.ticker = ticker.trim().toUpperCase();

  // ขั้น 3: ป้องกัน SSRF / Path Traversal
  // Block patterns ที่อาจเป็น URL, path, หรือ special characters
  // แม้ Regex ข้างบนจะกรองส่วนใหญ่แล้ว แต่เป็น Defense in Depth
  const blocked = ['HTTP', 'HTTPS', '..', '//', '\\'];
  const upper = req.params.ticker;
  if (blocked.some(pattern => upper.includes(pattern))) {
    return res.status(400).json({
      error: 'Ticker contains forbidden patterns.'
    });
  }

  next(); // ✅ ผ่านทุกขั้น → ส่งต่อไป Route Handler
};

// --- Date Validation Middleware ---
// ตรวจสอบ query params startDate/endDate ว่าเป็น format YYYY-MM-DD
// ป้องกัน: SQL Injection-style attacks ผ่าน date parameters
//          แม้เราไม่ใช้ DB แต่ค่าผิดอาจทำให้ buildDateRange() crash
const validateDateParams = (req, res, next) => {
  const { startDate, endDate } = req.query;
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  if (startDate && !ISO_DATE.test(startDate)) {
    return res.status(400).json({ error: 'Invalid startDate format. Use YYYY-MM-DD.' });
  }
  if (endDate && !ISO_DATE.test(endDate)) {
    return res.status(400).json({ error: 'Invalid endDate format. Use YYYY-MM-DD.' });
  }
  next();
};

/* added: helper to catch & log route registration errors so we can see the offending path */
function safeRegister(method, routePath, ...handlers) {
  try {
    if (typeof app[method] !== 'function') {
      console.error(`[Route] Unknown method: ${method} for path: ${routePath}`);
      return;
    }
    app[method](routePath, ...handlers);
    console.log(`[Route] Registered ${method.toUpperCase()} ${routePath}`);
  } catch (err) {
    console.error(`[Route] Failed to register ${method.toUpperCase()} ${routePath}:`, err && err.message ? err.message : err);
    throw err;
  }
}

// 🔒 Routes — ตอนนี้ทุก :ticker route ต้องผ่าน validateTicker ก่อน
// validateTicker ตรวจ format → validateDateParams ตรวจวันที่ → handler ทำงาน
// ถ้า input ไม่ผ่าน → return 400 Bad Request ทันที (ไม่เรียก handler)
safeRegister('get', '/api/stock/:ticker', validateTicker, getStockQuote);
safeRegister('get', '/api/stock/history/:ticker', validateTicker, validateDateParams, getStockHistory);
safeRegister('get', '/api/stock/dividends/:ticker', validateTicker, validateDateParams, getDividendHistory);
safeRegister('get', '/api/forex/usd-thb', getUsdThbRate);

// --- Health check route ---
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Simple root (health / quick check)
app.get('/', (req, res) => {
  res.send('Backend Is Ready!');
});

// Optional test data path
app.get('/api/stock-data', (req, res) => {
  res.json({
    symbol: 'PTT',
    price: 34.50,
    status: 'success'
  });
});

// --- Error monitoring: uncaught exceptions & unhandled rejections
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled Rejection:', reason && reason.stack ? reason.stack : reason);
});

// ======================================================
// === Serve static + SPA fallback
// ======================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// serve static when present (safe guard for split-deploy)
const staticPath = path.join(__dirname, '..', 'dist');
console.log('[Server] Static path:', staticPath);
if (fs.existsSync(staticPath)) {
  app.use(express.static(staticPath));
  const indexPath = path.join(staticPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    app.get(/.*/, (req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        return res.sendFile(indexPath, (err) => {
          if (err) {
            console.error('[Server] Error sending index.html:', err);
            next(err);
          }
        });
      }
      return next();
    });
    console.log('[Server] SPA fallback registered for static build.');
  } else {
    console.warn('[Server] index.html not found in static path — skipping SPA fallback.');
  }
} else {
  console.log('[Server] Static folder not present — skipping static serving.');
}

// =====================================================
// 🔒 [V8] Global Error Handler — ป้องกัน Information Leakage
// =====================================================
// ปัญหาเดิม: เมื่อเกิด error ภายใน → error message ดิบถูกส่งกลับ Client
//   เช่น: "ECONNREFUSED 127.0.0.1:3306" → เปิดเผยว่ามี MySQL อยู่
//   เช่น: "Cannot read property 'data' of undefined" → เปิดเผย code structure
// ความเสี่ยง: Attacker ใช้ข้อมูลจาก error messages เพื่อ:
//   - Mapping internal architecture
//   - หา Library version ที่มี known vulnerabilities
// แก้ไข: ส่ง generic error message ไป Client + log เต็มใน server
// อ้างอิง: OWASP A05:2021 - Security Misconfiguration
// อ้างอิง: CWE-209 (Generation of Error Message Containing Sensitive Information)
app.use((err, req, res, _next) => {
  // Log เต็มใน Server (สำหรับ Developer debug)
  console.error('[Global Error Handler]', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  // ส่งข้อมูลจำกัดไป Client — ป้องกัน Information Leakage
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred. Please try again later.'
      : err.message,  // Dev mode: แสดง error จริงเพื่อ debug
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Yahoo Finance Stock API is running on http://localhost:${PORT}`);
  console.log(`🔒 Security: Helmet ✅ | CORS Whitelist ✅ | Rate Limit ✅ | Input Validation ✅`);
});