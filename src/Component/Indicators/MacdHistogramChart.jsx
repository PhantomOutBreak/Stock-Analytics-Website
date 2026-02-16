import React, { useMemo } from 'react';
import { ResponsiveContainer, ComposedChart, CartesianGrid, YAxis, ReferenceLine, Bar, Cell } from 'recharts';
import { renderCommonXAxis, commonTooltip } from './common.jsx';

/**
 * MacdHistogramChart - กราฟแท่ง MACD Histogram
 * แสดงความแตกต่างระหว่าง MACD Line และ Signal Line
 * ค่าบวก = แนวโน้มขาขึ้น, ค่าลบ = แนวโน้มขาลง
 */
// React.memo ป้องกัน re-render ที่ไม่จำเป็น
export default React.memo(function MacdHistogramChart({ data = [], syncId, height, wrapperClassName = '', currency = '' }) {
  const chartRows = Array.isArray(data) ? data : []; // ตรวจสอบว่า data เป็น array

  // คำนวณค่า histogram ทั้งหมดที่เป็นตัวเลข
  const values = useMemo(() => chartRows.map(d => d.histogram).filter(v => Number.isFinite(v)), [chartRows]);

  // หาค่าสูงสุด (absolute) เพื่อกำหนดขอบเขตแกน Y
  const absMax = values.length ? Math.max(...values.map(v => Math.abs(v))) : 1;

  // เพิ่ม padding 15% เพื่อให้กราฟไม่ชิดขอบ
  const pad = useMemo(() => Math.max(absMax * 1.15, 0.5), [absMax]);

  const wrapperClasses = ['chart-wrapper', wrapperClassName].join(' ');

  // สร้างสีสำหรับแต่ละแท่ง
  // เขียว = บวก, แดง = ลบ
  // สีสว่าง = กำลังขึ้น, สีเข้ม = กำลังลง
  const barCells = useMemo(() => chartRows.map((row, idx) => {
    const val = row.histogram ?? 0;
    const prev = chartRows[idx - 1]?.histogram ?? val;
    const rising = val >= prev; // เช็คว่าแท่งนี้สูงกว่าแท่งก่อนหน้าไหม

    // กำหนดสี: บวก/ลบ × ขึ้น/ลง = 4 สี
    const fill = val >= 0
      ? (rising ? '#18f26a' : '#0e9f47')  // บวก: เขียวสว่าง/เขียวเข้ม
      : (rising ? '#ff2f45' : '#b71c1c'); // ลบ: แดงสว่าง/แดงเข้ม

    return <Cell key={`macd-bar-${idx}`} fill={fill} />;
  }), [chartRows]);

  // แสดง placeholder ถ้าไม่มีข้อมูล
  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className={wrapperClassName || 'chart-placeholder'} style={{ padding: 20 }}>No MACD data</div>;
  }

  return (
    <div className={wrapperClasses}>
      <h3>MACD Histogram</h3>
      <ResponsiveContainer width="100%" minWidth={280} height={height || 320}>
        <ComposedChart data={chartRows} margin={{ top: 5, right: 30, left: 0, bottom: 20 }} syncId={syncId}>
          {/* เส้นตารางพื้นหลัง */}
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />

          {/* แกน X: วันที่ */}
          {renderCommonXAxis()}

          {/* แกน Y: ค่า histogram (สมมาตรรอบ 0) */}
          <YAxis
            yAxisId="left"
            tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
            tickFormatter={v => (Number.isFinite(v) ? v.toFixed(2) : '')}
            width={44}
            domain={[-pad, pad]} // บังคับให้แกน Y เป็นบวก/ลบเท่ากัน
          />

          {/* Tooltip แสดงข้อมูลเมื่อชี้เมาส์ */}
          {commonTooltip(currency)}

          {/* เส้นอ้างอิงที่ 0 (แบ่งโซนบวก/ลบ) */}
          <ReferenceLine yAxisId="left" y={0} stroke="var(--color-border)" strokeWidth={1.2} />

          {/* แท่ง Histogram พร้อมสีที่คำนวณไว้ */}
          <Bar yAxisId="left" dataKey="histogram" name="MACD Histogram" barSize={8} fill="#00fff2ff">
            {barCells}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});