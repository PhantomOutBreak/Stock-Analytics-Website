import React, { useMemo } from 'react';
import { ResponsiveContainer, ComposedChart, CartesianGrid, Bar, YAxis, Cell } from 'recharts';
import { renderCommonXAxis, commonTooltip } from './common.jsx';

/**
 * VolumeChart - Component สำหรับแสดงกราฟปริมาณการซื้อขาย (Volume)
 * 
 * ใช้เพื่อแสดงมูลค่าการซื้อขายในแต่ละวัน ช่วยในการวิเคราะห์ Trend และ Momentum ของหุ้น
 * ถ้า Volume สูง แสดงถึงความสนใจที่มาก (Confirm Trend)
 * ถ้า Volume ต่ำ แสดงถึงความสนใจที่น้อย
 * 
 * Props:
 * @param {Array} data - ข้อมูลหุ้นรายวัน [{ date, volume, isUp, ... }]
 * @param {string} syncId - ใช้สำหรับ Sync การ Zoom/Pan กับกราฟราคา
 * @param {number} height - ความสูงของกราฟ (default: 260px)
 * @param {string} wrapperClassName - CSS wrapper class
 * @param {string} currency - สกุลเงิน (สำหรับ Tooltip)
 */
// React.memo เพื่อป้องกันการ Re-render โดยไม่จำเป็น
export default React.memo(function VolumeChart({ data = [], syncId, height, wrapperClassName = '', currency = '' }) {
  const wrapperClasses = ['chart-wrapper', wrapperClassName].filter(Boolean).join(' ');

  // === กำหนดสีของแท่ง Volume ===
  // ถ้าหุ้นปิดบวก (isUp = true) -> สีเขียว (Buying Volume)
  // ถ้าหุ้นปิดลบ (isUp = false) -> สีแดง (Selling Volume)
  const cells = useMemo(() => (data || []).map((e, i) => (
    <Cell key={i} fill={e.isUp ? 'var(--color-success)' : '#d32f2f'} />
  )), [data]);

  // แสดง Placeholder ถ้าไม่มีข้อมูล
  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className={wrapperClassName || 'chart-placeholder'} style={{ padding: 20 }}>No volume data</div>;
  }

  return (
    <div className={wrapperClasses}>
      <h3>Volume</h3>
      <ResponsiveContainer width="100%" height={height || 260}>
        <ComposedChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 20 }} syncId={syncId}>
          {/* เส้นตารางพื้นหลัง */}
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />

          {/* แกน X (วันที่) - ใช้ฟังก์ชันกลางจาก common.jsx */}
          {renderCommonXAxis()}

          {/* แกน Y (Volume) */}
          <YAxis
            tick={{ fill: '#4be100ff', fontSize: 12 }}
            domain={[0, (max) => Math.ceil(max * 1.15)]} // เพิ่ม Padding ด้านบน 15%
            tickFormatter={v => v.toLocaleString()}      // จัดรูปแบบตัวเลข (มีลูกน้ำ)
          />

          {/* Tooltip และการแสดงผลแท่งกราฟ */}
          {commonTooltip(currency)}
          <Bar dataKey="volume" name="Volume" fillOpacity={0.9} fill="#00f7ffff">
            {cells} {/* ใส่สีแยกตามแท่ง */}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});