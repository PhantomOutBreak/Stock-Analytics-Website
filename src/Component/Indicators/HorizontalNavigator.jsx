import React, { useRef, useEffect, useState } from 'react';

/**
 * HorizontalNavigator - ตัวควบคุมการนำทางแนวนอน (Scrollbar + Zoom)
 * 
 * ใช้สำหรับควบคุมช่วงข้อมูลที่แสดงผล (Visible Range) ของกราฟหรือรายการข้อมูลยาวๆ
 * ผู้ใช้สามารถ:
 * 1. ลากแถบ (Thumb) เพื่อเลื่อนช่วงข้อมูล (Pan)
 * 2. ลากขอบซ้าย/ขวา เพื่อย่อ/ขยายช่วงข้อมูล (Zoom)
 * 
 * Props:
 * @param {number} totalItems - จำนวนข้อมูลทั้งหมด
 * @param {number} visibleStart - index เริ่มต้นที่แสดงอยู่
 * @param {number} visibleEnd - index สุดท้ายที่แสดงอยู่
 * @param {function} onZoomChange - callback เมื่อมีการเลื่อนหรือย่อขยาย (newStart, newEnd) => void
 * @param {number} height - ความสูงของ navigator (default = 40px)
 */
export default function HorizontalNavigator({
    totalItems,
    visibleStart,
    visibleEnd,
    onZoomChange,
    height = 40
}) {
    const containerRef = useRef(null); // อ้างอิงถึง div หลักของ navigator

    // === State สำหรับการ Dragging ===
    const [isDragging, setIsDragging] = useState(false);       // กำลังลากอยู่หรือไม่
    const [dragAction, setDragAction] = useState(null);        // การกระทำ: 'move' (เลื่อน), 'left-resize' (ย่อขยายซ้าย), 'right-resize' (ย่อขยายขวา)
    const [startX, setStartX] = useState(0);                   // ตำแหน่งเมาส์เริ่มต้นตอนกด (Screen X)
    const [initialWindow, setInitialWindow] = useState({ start: 0, end: 0 }); // ค่า visibleStart/End ตอนเริ่มกด

    // === คำนวณตำแหน่งและความกว้างของแถบ (Thumb) ===
    // แปลง index เป็น % เทียบกับความกว้างทั้งหมด
    const startPct = totalItems > 0 ? (visibleStart / totalItems) * 100 : 0;
    const endPct = totalItems > 0 ? (visibleEnd / totalItems) * 100 : 100;
    const widthPct = Math.max(endPct - startPct, 1); // บังคับความกว้างขั้นต่ำ 1% เพื่อให้มองเห็นเสมอ

    /**
     * handleMouseDown - เริ่มต้นการลาก
     * @param {Object} e - Mouse Event
     * @param {string} action - 'move', 'left-resize', 'right-resize'
     */
    const handleMouseDown = (e, action) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
        setDragAction(action);
        setStartX(e.clientX); // เก็บตำแหน่งเมาส์ X ปัจจุบัน
        setInitialWindow({ start: visibleStart, end: visibleEnd }); // snapshot ค่าปัจจุบันไว้
    };

    // ใช้ useEffect จัดการ MouseMove และ MouseUp ที่ window level (เพื่อให้ลากออกนอกพื้นที่ได้)
    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isDragging || !containerRef.current || totalItems <= 0) return;

            const rect = containerRef.current.getBoundingClientRect(); // ขนาดและตำแหน่งของ container
            const deltaPixels = e.clientX - startX; // ระยะทางที่เมาส์เลื่อนไป (pixels)

            // === แปลงระยะทาง Pixel เป็นจำนวน Item ===
            // pixelsPerItem = ความกว้างทั้งหมด (px) / จำนวนข้อมูลทั้งหมด (items)
            const pixelsPerItem = rect.width / totalItems;
            const deltaItems = Math.round(deltaPixels / pixelsPerItem); // จำนวน items ที่เลื่อนไป

            if (deltaItems === 0 && dragAction !== 'move') return; // Sensitivity check

            let newStart = initialWindow.start;
            let newEnd = initialWindow.end;
            const minWindowSize = Math.max(10, Math.floor(totalItems * 0.01)); // กำหนดขนาดหน้าต่างขั้นต่ำ (10 items หรือ 1%)

            // === Logic การคำนวณตำแหน่งใหม่ตาม Action ===
            if (dragAction === 'move') {
                // กรณีเลื่อนแถบ (Pan)
                const span = initialWindow.end - initialWindow.start; // ความกว้างช่วงเดิม

                // เลื่อนทั้ง start และ end ไปพร้อมกัน
                newStart = initialWindow.start + deltaItems;
                newEnd = newStart + span;

                // Clamp (จำกัดขอบเขต) ไม่ให้เลยซ้าย/ขวา
                if (newStart < 0) {
                    newStart = 0;
                    newEnd = span; // คงขนาดช่วงไว้เท่าเดิม
                }
                if (newEnd > totalItems) {
                    newEnd = totalItems;
                    newStart = totalItems - span; // คงขนาดช่วงไว้เท่าเดิม
                }
            } else if (dragAction === 'left-resize') {
                // กรณีปรับขนาดด้านซ้าย
                newStart = initialWindow.start + deltaItems;

                // ป้องกันไม่ให้ start เกิน end (ติด minWindowSize)
                if (newStart > initialWindow.end - minWindowSize) {
                    newStart = initialWindow.end - minWindowSize;
                }
                // จำกัดขอบซ้ายสุดที่ 0
                if (newStart < 0) newStart = 0;

                // update เฉพาะ start (end คงเดิม)
                newEnd = initialWindow.end;

            } else if (dragAction === 'right-resize') {
                // กรณีปรับขนาดด้านขวา
                newEnd = initialWindow.end + deltaItems;

                // ป้องกันไม่ให้ end ต่ำกว่า start (ติด minWindowSize)
                if (newEnd < initialWindow.start + minWindowSize) {
                    newEnd = initialWindow.start + minWindowSize;
                }
                // จำกัดขอบขวาสุดที่ totalItems
                if (newEnd > totalItems) newEnd = totalItems;

                // update เฉพาะ end (start คงเดิม)
                newStart = initialWindow.start;
            }

            // ส่งค่าใหม่กลับไปยัง Parent Component
            if (newStart !== visibleStart || newEnd !== visibleEnd) {
                onZoomChange(newStart, newEnd);
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setDragAction(null);
        };

        // Attach event listeners to window เพื่อให้ลากได้ต่อเนื่องแม้เมาส์หลุดออกจาก component
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragAction, startX, initialWindow, totalItems, onZoomChange, visibleStart, visibleEnd]);

    return (
        <div
            ref={containerRef}
            style={{
                width: '100%',
                height: height,
                background: 'rgba(10, 15, 25, 0.5)',   // พื้นหลังโปร่งแสง
                border: '1px solid rgba(255, 255, 255, 0.05)',
                position: 'relative',
                borderRadius: '8px',
                overflow: 'hidden',
                cursor: 'grab',                        // cursor รูปมือจับ
                marginTop: '16px',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)', // เงาด้านในสร้างมิติ
                backdropFilter: 'blur(10px)'           // glassmorphism effect
            }}
            // เปลี่ยนสีขอบเมื่อ hover (Visual Feedback)
            onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'; }}
            onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)'; }}
        >
            {/* Background Track - ลายเส้น Grid จางๆ เพื่อความสวยงาม */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.1, backgroundImage: 'linear-gradient(90deg, transparent 49%, rgba(255,255,255,0.1) 50%, transparent 51%)', backgroundSize: '20px 100%' }}>
            </div>

            {/* The Window Thumb (แถบเลื่อน) */}
            <div
                style={{
                    position: 'absolute',
                    left: `${startPct}%`,
                    width: `${widthPct}%`,
                    top: 4,
                    bottom: 4,
                    background: 'rgba(99, 102, 241, 0.15)', // สีม่วงอ่อนโปร่งแสง
                    border: '1px solid #6366f1',           // ขอบสีม่วงเข้ม
                    borderRadius: '6px',
                    boxSizing: 'border-box',
                    transition: isDragging ? 'none' : 'background 0.2s', // ถ้าลากอยู่ไม่ต้อง animate
                    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
                }}
                onMouseDown={(e) => handleMouseDown(e, 'move')} // เริ่มลากเพื่อเลื่อน
                onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.background = 'rgba(99, 102, 241, 0.25)'; }}
                onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.background = 'rgba(99, 102, 241, 0.15)'; }}
            >
                {/* Left Resize Handle (ที่จับสำหรับย่อขยายด้านซ้าย) */}
                <div
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: '12px',
                        cursor: 'ew-resize', // cursor ลูกศรซ้ายขวา
                        zIndex: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'left-resize')}
                >
                    {/* ขีดแนวตั้งเล็กๆ ตรง handle */}
                    <div style={{ width: '3px', height: '16px', background: 'rgba(255,255,255,0.4)', borderRadius: '2px' }}></div>
                </div>

                {/* Center Grip Indicator (ขีดตกแต่งตรงกลางแถบ) */}
                <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '32px',
                    height: '4px',
                    background: 'linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.8), transparent)',
                    borderRadius: '2px',
                    pointerEvents: 'none'
                }} />

                {/* Right Resize Handle (ที่จับสำหรับย่อขยายด้านขวา) */}
                <div
                    style={{
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: '12px',
                        cursor: 'ew-resize', // cursor ลูกศรซ้ายขวา
                        zIndex: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'right-resize')}
                >
                    {/* ขีดแนวตั้งเล็กๆ ตรง handle */}
                    <div style={{ width: '3px', height: '16px', background: 'rgba(255,255,255,0.4)', borderRadius: '2px' }}></div>
                </div>
            </div>
        </div>
    );
}
