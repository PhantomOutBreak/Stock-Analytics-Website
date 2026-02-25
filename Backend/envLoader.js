/**
 * =====================================================
 * envLoader.js - ตัวโหลดค่า Environment Variables แบบอัจฉริยะ
 * =====================================================
 * 
 * ไฟล์นี้ทำหน้าที่โหลดค่าจากไฟล์ .env โดยมีระบบ Fallback เพื่อรองรับ
 * การ Encode แบบต่างๆ (เช่น UTF-16 LE ที่ Windows บางทีสร้างขึ้นมา)
 * 
 * **ปัญหาที่แก้ไข:**
 * - dotenv มาตรฐานอ่านไฟล์ .env ที่เป็น UTF-16 LE ไม่ได้
 * - Windows บางเวอร์ชันสร้างไฟล์ .env เป็น UTF-16 LE with BOM
 * 
 * **วิธีการทำงาน:**
 * 1. พยายามโหลดด้วย dotenv ปกติก่อน
 * 2. ถ้าไม่สำเร็จ หรือไม่พบ TWELVE_DATA_API_KEY
 *    → อ่านไฟล์แบบ Manual และตรวจสอบ Encoding
 * 3. ถ้าเจอ BOM ของ UTF-16 LE (0xFF 0xFE) → ใช้ utf16le decoder
 * 4. Extract ค่า API Key ด้วย Regex และทำความสะอาด (ลบ quotes, null bytes)
 */

import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

/**
 * ฟังก์ชันหลักสำหรับโหลดไฟล์ .env
 * @param {string} envPath - Path เต็มไปยังไฟล์ .env
 * @returns {object} - { loaded: boolean, keyPresent: boolean }
 */
export function loadEnv(envPath) {
    console.log(`[EnvLoader] Loading .env from: ${envPath}`);

    // ตรวจสอบว่าไฟล์มีอยู่จริงหรือไม่
    if (!fs.existsSync(envPath)) {
        console.warn('[EnvLoader] .env file not found.');
        return { loaded: false };
    }

    // === วิธีที่ 1: ลองใช้ dotenv มาตรฐาน ===
    const result = dotenv.config({ path: envPath });
    const dotenvLoaded = result.parsed && Object.keys(result.parsed).length > 0;

    // === วิธีที่ 2: Fallback แบบ Manual (รองรับ UTF-16 LE / BOM) ===
    // ถ้า dotenv โหลดไม่สำเร็จ หรือไม่พบ API Key → ลองอ่านแบบ manual
    let manuallyLoaded = false;
    if (!dotenvLoaded || !process.env.TWELVE_DATA_API_KEY) {
        try {
            console.log('[EnvLoader] Attempting manual read (smart decode)...');

            // อ่านไฟล์เป็น Buffer (ยังไม่ decode)
            const buf = fs.readFileSync(envPath);
            let content = '';

            // ตรวจสอบ BOM (Byte Order Mark) สำหรับ UTF-16 LE
            // UTF-16 LE BOM = 0xFF 0xFE (ตัวแรก 2 bytes)
            if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
                console.log('[EnvLoader] Detected UTF-16 LE encoding.');
                content = buf.toString('utf16le'); // Decode ด้วย UTF-16 LE
            } else {
                content = buf.toString('utf8'); // Default ใช้ UTF-8
            }

            // ค้นหาค่า TWELVE_DATA_API_KEY ด้วย Regular Expression
            // รองรับรูปแบบ: TWELVE_DATA_API_KEY=value หรือ TWELVE_DATA_API_KEY = value
            const match = content.match(/TWELVE_DATA_API_KEY\s*=\s*(.*?)(\r|\n|$)/i);

            if (match && match[1]) {
                let key = match[1].trim();

                // ทำความสะอาดค่า Key:
                key = key.replace(/^["']|["']$/g, ''); // ลบ quotes (", ') ที่หุ้มอยู่
                key = key.replace(/\u0000/g, ''); // ลบ null bytes ที่ UTF-16 อาจมี
                key = key.trim();

                // ถ้ายังมีค่าเหลืออยู่ → บันทึกลง process.env
                if (key) {
                    process.env.TWELVE_DATA_API_KEY = key;
                    manuallyLoaded = true;
                    // 🔒 [V5] Security Fix: ไม่แสดง API Key (แม้บางส่วน) ใน logs
                    // ปัญหาเดิม: แสดง 4 ตัวแรก → ลด brute-force search space
                    // แก้ไข: แสดงแค่สถานะว่าโหลดสำเร็จหรือไม่
                    console.log('[EnvLoader] API key successfully loaded.');
                }
            }
        } catch (e) {
            console.error('[EnvLoader] Manual parse error:', e.message);
        }
    }

    // แสดงสถานะสรุป
    const finalKey = process.env.TWELVE_DATA_API_KEY;
    console.log(`[EnvLoader] Status: dotenv=${dotenvLoaded}, manual=${manuallyLoaded}, KeyPresent=${!!finalKey}`);

    return {
        loaded: dotenvLoaded || manuallyLoaded, // สำเร็จถ้าโหลดได้ด้วยวิธีใดวิธีหนึ่ง
        keyPresent: !!finalKey // มี API Key หรือไม่
    };
}
