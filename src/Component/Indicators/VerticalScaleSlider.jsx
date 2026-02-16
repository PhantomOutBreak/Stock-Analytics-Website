import React from 'react';

/**
 * VerticalScaleSlider - ตัวควบคุมการขยายความสูงของกราฟ (Vertical Zoom)
 * 
 * Component นี้จะแสดง Slider แนวตั้งทางด้านขวาของหน้าจอ เพื่อให้ผู้ใช้สามารถ
 * ปรับความสูงของกราฟ (Scale) ได้ตามต้องการ ช่วยให้มองเห็นการเคลื่อนไหวของราคาได้ชัดเจนขึ้น
 * โดยเฉพาะในช่วงที่ราคามีความผันผวนน้อย หรือต้องการขยายดูรายละเอียด
 * 
 * Props:
 * @param {number} scale - ค่า Scale ปัจจุบัน (เช่น 1.0 = ปกติ, 2.0 = ขยาย 2 เท่า)
 * @param {function} onChange - callback เมื่อค่า Scale เปลี่ยน (newScale) => void
 * @param {number} min - ค่า Scale ต่ำสุด (default: 0.1)
 * @param {number} max - ค่า Scale สูงสุด (default: 5.0)
 * @param {number} step - ระดับการเพิ่มลดต่อครั้ง (default: 0.1)
 */
export default function VerticalScaleSlider({ scale, onChange, min = 0.1, max = 5.0, step = 0.1 }) {
    // === Logic การทำงานของปุ่มควบคุม ===
    // เพิ่ม Scale ทีละ step (ไม่เกิน max)
    const increment = () => onChange(Math.min(max, scale + step));
    // ลด Scale ทีละ step (ไม่ต่ำกว่า min)
    const decrement = () => onChange(Math.max(min, scale - step));
    // รีเซ็ต Scale กลับเป็นค่าเริ่มต้น (1.0)
    const reset = () => onChange(1.0);

    // === Style สำหรับปุ่มกด (Glassmorphism) ===
    const buttonStyle = {
        width: '28px',
        height: '28px',
        cursor: 'pointer',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'rgba(255, 255, 255, 0.05)',
        color: '#cbd5e1', // สีเทาอ่อน
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', // Animation นุ่มนวล
    };

    // Effect เมื่อเอาเมาส์ชี้ปุ่ม (Hover Effect)
    const handleMouseEnter = (e) => {
        e.target.style.background = 'rgba(34, 211, 238, 0.1)'; // สีฟ้าอ่อนโปร่งแสง
        e.target.style.borderColor = 'rgba(34, 211, 238, 0.4)';
        e.target.style.color = '#fff';
        e.target.style.transform = 'translateY(-2px)'; // ลอยขึ้นเล็กน้อย
        e.target.style.boxShadow = '0 4px 12px rgba(34, 211, 238, 0.2)'; // มีเงาสีฟ้า
    };

    // Effect เมื่อเอาเมาส์ออก (Reset Style)
    const handleMouseLeave = (e) => {
        e.target.style.background = 'rgba(255, 255, 255, 0.05)';
        e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        e.target.style.color = '#cbd5e1';
        e.target.style.transform = 'none';
        e.target.style.boxShadow = 'none';
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '12px 6px',
            background: 'rgba(10, 15, 25, 0.5)',   // พื้นหลังทึบแสงเล็กน้อย
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '16px',
            height: '100%',
            justifyContent: 'center',
            gap: '12px',
            backdropFilter: 'blur(10px)'           // เบลอพื้นหลัง
        }}>
            {/* Label "Scale" แนวตั้ง */}
            <div style={{
                fontSize: '11px',
                fontWeight: '700',
                color: '#94a3b8',
                writingMode: 'vertical-rl', // ตัวอักษรเรียงแนวตั้ง
                transform: 'rotate(180deg)', // หมุนให้หัวตั้งขึ้น
                letterSpacing: '0.1em',
                textTransform: 'uppercase'
            }}>
                Scale
            </div>

            {/* ปุ่มบวก (+) */}
            <button
                onClick={increment}
                style={buttonStyle}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                title="Zoom In (Height)"
            >
                +
            </button>

            {/* Range Slider แนวตั้ง */}
            <div style={{ position: 'relative', height: '180px', display: 'flex', alignItems: 'center' }}>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={scale}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="vertical-slider-input" // Class สำหรับ pseudo-elements (ถ้ามี)
                    style={{
                        writingMode: 'vertical-lr',      // ทำให้ Slider เป็นแนวตั้ง (Chrome/Edge/Safari)
                        direction: 'rtl',                // ให้ค่ามากอยู่ด้านบน (Top)
                        appearance: 'slider-vertical',   // Standard CSS property
                        width: '6px',
                        height: '100%',
                        margin: 0,
                        background: 'rgba(255, 255, 255, 0.1)',
                        borderRadius: '3px',
                        cursor: 'ns-resize',             // Cursor รูปลูกศรขึ้นลง
                        accentColor: '#22d3ee'           // สีหลักของ Slider (สีฟ้า)
                    }}
                />
            </div>

            {/* ปุ่มลบ (-) */}
            <button
                onClick={decrement}
                style={buttonStyle}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                title="Zoom Out (Height)"
            >
                -
            </button>

            {/* ปุ่ม Reset (1x) */}
            <button
                onClick={reset}
                title="Reset to 1x"
                style={{
                    ...buttonStyle,
                    fontSize: '10px',
                    height: 'auto',
                    padding: '4px 6px',
                    width: '100%',
                    marginTop: '4px',
                    borderRadius: '8px',
                    background: 'rgba(99, 102, 241, 0.1)', // สีม่วงอ่อน
                    borderColor: 'rgba(99, 102, 241, 0.2)',
                    color: '#818cf8'
                }}
                onMouseEnter={(e) => {
                    e.target.style.background = 'rgba(99, 102, 241, 0.2)';
                    e.target.style.color = '#fff';
                    e.target.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                    e.target.style.background = 'rgba(99, 102, 241, 0.1)';
                    e.target.style.color = '#818cf8';
                    e.target.style.transform = 'none';
                }}
            >
                1x
            </button>

            {/* แสดงตัวเลขค่า Scale ปัจจุบัน */}
            <div style={{ fontSize: '10px', color: '#22d3ee', fontWeight: '600', fontFamily: 'monospace' }}>
                {scale.toFixed(1)}x
            </div>
        </div>
    );
}
