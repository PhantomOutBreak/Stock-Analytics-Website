/**
 * =====================================================
 * PriceChart.jsx - กราฟราคาหุ้นพร้อม Indicators
 * =====================================================
 * 
 * **จุดประสงค์:**
 * Component หลักสำหรับแสดงกราฟราคาหุ้นพร้อม Technical Indicators
 * 
 * **Features:**
 * - Price Line: เส้นราคาปิดรายวัน
 * - SMA (10, 50, 100, 200): ค่าเฉลี่ยเคลื่อนที่แบบธรรมดา
 * - EMA (50, 100, 200): ค่าเฉลี่ยเคลื่อนที่แบบเลขชี้กำลัง
 * - Bollinger Bands: แถบราคาบน-ล่าง (ส่วนเบี่ยงเบนมาตรฐาน)
 * - Signals: จุดสัญญาณซื้อ/ขาย (RSI Cross, Golden/Death Cross, MACD)
 * - Fibonacci Retracement: เส้น Fibonacci Levels
 * - High/Low Peaks: จุดราคาสูงสุด/ต่ำสุด
 * 
 * **Props:**
 * @param {Array} data - ข้อมูลราคารายวัน พร้อม Indicators
 * @param {Array} signals - จุดสัญญาณต่างๆ
 * @param {Object} visible - ตัวเลือกแสดง/ซ่อน Indicators
 * @param {string} currency - สกุลเงิน (THB, USD)
 */

import React, { useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, ReferenceLine, ReferenceDot,
  CartesianGrid, Legend, YAxis, ReferenceArea
} from 'recharts';
import { chartMargin, renderCommonXAxis, commonTooltip, formatPriceTick, getPaddedDomain } from './common.jsx';

// React.memo ป้องกัน re-render เมื่อ props ไม่เปลี่ยน (Performance optimization)
export default React.memo(function PriceChart({
  data = [],                    // ข้อมูลราคารายวัน + indicators
  signals = [],                 // สัญญาณ RSI Cross
  smaSignals = [],              // สัญญาณ SMA Cross
  goldenDeathSignals = [],      // สัญญาณ Golden/Death Cross
  goldenDeathZones = [],        // โซนพื้นหลัง Golden/Death
  macdStrategySignals = [],     // สัญญาณ MACD Strategy
  highLowPeaks = [],            // จุด High/Low ของแต่ละช่วงเวลา
  fibonacci,                    // ข้อมูล Fibonacci Retracement
  syncId,                       // ID สำหรับ sync zoom/pan กับกราฟอื่น
  height,                       // ความสูงกราฟ
  padPct,                       // % padding ของแกน Y
  wrapperClassName = '',        // CSS class เพิ่มเติม
  currency = '',                // สกุลเงิน (THB/USD)
  visible = {}                  // ตัวเลือกแสดง/ซ่อน indicators
}) {
  // === คำนวณจุด Overbought/Oversold (ราคาทะลุ Bollinger Bands) ===
  const obos = useMemo(() => (data || [])
    .filter(d => d.bbUpper != null && (d.close > d.bbUpper || d.close < d.bbLower)) // กรองเฉพาะจุดที่ทะลุ BB
    .map(d => ({
      date: d.date,
      type: d.close > d.bbUpper ? 'overbought' : 'oversold',  // ทะลุบน = OB, ทะลุล่าง = OS
      value: d.close
    })), [data]);

  const wrapperClasses = ['chart-wrapper', wrapperClassName].filter(Boolean).join(' ');

  // === รวม Fibonacci levels เข้าไปในการคำนวณ Y-Axis Domain ===
  // เพื่อให้เส้น Fibonacci แสดงอยู่ในกราฟเสมอ (ไม่ตกนอกขอบ)
  const fibLevels = (visible.fib && fibonacci?.levels) ? fibonacci.levels.map(l => l.value) : [];

  // === รวบรวมค่าทั้งหมดที่จะแสดงในกราฟ เพื่อคำนวณขอบเขตแกน Y ===
  const domainValues = useMemo(() => [
    ...(data || []).flatMap(d => [
      d.close,                                  // ราคาปิด (แสดงเสมอ)
      visible.bb ? d.bbUpper : null,            // Bollinger Band บน
      visible.bb ? d.bbLower : null,            // Bollinger Band ล่าง
      visible.sma ? d.sma10 : null,             // SMA 10
      visible.sma ? d.sma50 : null,             // SMA 50
      visible.sma ? d.sma100 : null,            // SMA 100
      visible.sma ? d.sma200 : null,            // SMA 200
      visible.ema ? d.ema50 : null,             // EMA 50
      visible.ema ? d.ema100 : null,            // EMA 100
      visible.ema ? d.ema200 : null             // EMA 200
    ]),
    ...fibLevels                                // เพิ่ม Fibonacci levels
  ].filter(v => typeof v === 'number'), [data, visible, fibonacci, padPct]);

  // คำนวณ Y-Axis Min/Max พร้อม padding (default 6%)
  const [yMin, yMax] = useMemo(() => getPaddedDomain(domainValues, padPct ?? 0.06), [domainValues, padPct]);

  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className={wrapperClassName || 'chart-placeholder'} style={{ padding: 20 }}>No price data</div>;
  }

  return (
    <div className={wrapperClasses}>
      <h3>Price Action & Indicators</h3>
      <ResponsiveContainer width="100%" height={height || 380}>
        <ComposedChart data={data} margin={chartMargin} syncId={syncId}>
          <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
          {renderCommonXAxis()}
          <YAxis
            yAxisId="left"
            domain={[yMin, yMax]}
            tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
            tickFormatter={formatPriceTick}
            width={60}
          />

          {/* === Bollinger Bands (แถบบน-กลาง-ล่าง) === */}
          {/* แถบบน: ขอบเขตราคาแพง (Overbought zone) */}
          {visible.bb && <Line yAxisId="left" dataKey="bbUpper" name="Upper BB" stroke="#64b5f6" strokeDasharray="4 2" dot={false} strokeWidth={1.5} isAnimationActive={false} />}
          {/* แถบกลาง: SMA(20) - เส้นฐาน */}
          {visible.bb && <Line yAxisId="left" dataKey="bbMiddle" name="Middle BB" stroke="#ffa726" strokeWidth={2} dot={false} isAnimationActive={false} />}
          {/* แถบล่าง: ขอบเขตราคาถูก (Oversold zone) */}
          {visible.bb && <Line yAxisId="left" dataKey="bbLower" name="Lower BB" stroke="#64b5f6" strokeDasharray="4 2" dot={false} strokeWidth={1.5} isAnimationActive={false} />}

          {/* === SMA (Simple Moving Average) - ค่าเฉลี่ยเคลื่อนที่แบบธรรมดา === */}
          {visible.sma && <Line yAxisId="left" dataKey="sma10" name="SMA 10" stroke="#e91e63" strokeWidth={2.5} dot={false} isAnimationActive={false} />}   {/* ชมพู - ระยะสั้น */}
          {visible.sma && <Line yAxisId="left" dataKey="sma50" name="SMA 50" stroke="#00bcd4" strokeWidth={2.5} dot={false} isAnimationActive={false} />}   {/* ฟ้า - ระยะกลาง */}
          {visible.sma && <Line yAxisId="left" dataKey="sma100" name="SMA 100" stroke="#ffc107" strokeWidth={2.5} dot={false} isAnimationActive={false} />} {/* เหลือง - ระยะกลาง-ยาว */}
          {visible.sma && <Line yAxisId="left" dataKey="sma200" name="SMA 200" stroke="#4caf50" strokeWidth={2.5} dot={false} isAnimationActive={false} />} {/* เขียว - ระยะยาว */}

          {/* === EMA (Exponential Moving Average) - ค่าเฉลี่ยเคลื่อนที่แบบเลขชี้กำลัง === */}
          {/* EMA ตอบสนองต่อราคาเร็วกว่า SMA เพราะให้น้ำหนักกับข้อมูลล่าสุดมากกว่า */}
          {visible.ema && <Line yAxisId="left" dataKey="ema50" name="EMA 50" stroke="#ff6f00" strokeWidth={2.5} dot={false} isAnimationActive={false} />}   {/* ส้ม */}
          {visible.ema && <Line yAxisId="left" dataKey="ema100" name="EMA 100" stroke="#00897b" strokeWidth={2.5} dot={false} isAnimationActive={false} />} {/* เขียวเข้ม */}
          {visible.ema && <Line yAxisId="left" dataKey="ema200" name="EMA 200" stroke="#7b1fa2" strokeWidth={2.5} dot={false} isAnimationActive={false} />} {/* ม่วง */}

          {/* === Peak High/Low Markers - จุดราคาสูงสุด/ต่ำสุดของแต่ละช่วงเวลา === */}
          {/* Weekly High/Low: จุดสูง/ต่ำของแต่ละสัปดาห์ */}
          {visible.weeklyHighLow && highLowPeaks
            .filter(p => p.type === 'weeklyHigh' || p.type === 'weeklyLow')
            .map((p, i) => (
              <ReferenceDot
                key={`weekly-${i}-${p.date}`}
                yAxisId="left"
                x={p.date}
                y={p.value}
                r={6}  // ขนาดจุด
                fill={p.type === 'weeklyHigh' ? '#2962ff' : '#00b0ff'}  // น้ำเงินเข้ม/อ่อน
                stroke="#fff"
                strokeWidth={1}
                label={{ value: p.type === 'weeklyHigh' ? 'W↑' : 'W↓', fill: '#fff', fontSize: 9, position: 'top' }}
              />
            ))
          }

          {/* Monthly High/Low: จุดสูง/ต่ำของแต่ละเดือน */}
          {visible.monthlyHighLow && highLowPeaks
            .filter(p => p.type === 'monthlyHigh' || p.type === 'monthlyLow')
            .map((p, i) => (
              <ReferenceDot
                key={`monthly-${i}-${p.date}`}
                yAxisId="left"
                x={p.date}
                y={p.value}
                r={7}  // ใหญ่กว่า Weekly เล็กน้อย
                fill={p.type === 'monthlyHigh' ? '#aa00ff' : '#ea80fc'}  // ม่วงเข้ม/อ่อน
                stroke="#fff"
                strokeWidth={1}
                label={{ value: p.type === 'monthlyHigh' ? 'M↑' : 'M↓', fill: '#fff', fontSize: 9, position: 'top' }}
              />
            ))
          }

          {/* Yearly High/Low: จุดสูง/ต่ำของแต่ละปี (สำคัญที่สุด) */}
          {visible.yearlyHighLow && highLowPeaks
            .filter(p => p.type === 'yearlyHigh' || p.type === 'yearlyLow')
            .map((p, i) => (
              <ReferenceDot
                key={`yearly-${i}-${p.date}`}
                yAxisId="left"
                x={p.date}
                y={p.value}
                r={8}  // ใหญ่ที่สุด
                fill={p.type === 'yearlyHigh' ? '#ff6d00' : '#ffd600'}  // ส้ม/เหลือง
                stroke="#fff"
                strokeWidth={1.5}
                label={{ value: p.type === 'yearlyHigh' ? 'Y↑' : 'Y↓', fill: '#fff', fontSize: 10, position: 'top' }}
              />
            ))
          }

          {/* === เส้นราคาปิด (Price Line) === */}
          <Line yAxisId="left" dataKey="close" name="Close Price" stroke="#cececeff" strokeWidth={3} dot={false} isAnimationActive={false} />

          {/* Tooltip และ Legend */}
          {commonTooltip(currency)}
          <Legend />

          {/* เส้นอ้างอิงราคาปิดล่าสุด (Last Price Reference Line) */}
          {Number.isFinite(data?.[data.length - 1]?.close) && (
            <ReferenceLine
              yAxisId="left"
              y={data[data.length - 1].close}
              stroke="#555"
              strokeDasharray="3 3"
              label={{ value: `Last ${formatPriceTick(data[data.length - 1].close)}`, position: 'right', fill: '#555', fontSize: 10 }}
            />
          )}

          {/* === Fibonacci Retracement Levels === */}
          {/* เส้น Fibonacci: 0%, 23.6%, 38.2%, 50%, 61.8%, 100% */}
          {visible.fib && fibonacci && Array.isArray(fibonacci.levels) && fibonacci.levels.map(l => (
            <ReferenceLine
              key={`fib-${l.level}`}
              yAxisId="left"
              y={l.value}
              stroke={l.color || '#ffa000'}
              strokeDasharray={l.level.includes('0%') || l.level.includes('100%') ? '3 0' : '4 4'}  // 0%/100% เป็นเส้นทึบ
              strokeWidth={l.level.includes('0%') || l.level.includes('100%') ? 1.5 : 1}
              label={{ value: l.level, position: 'insideRight', fontSize: 11, fill: l.color || '#ffa000', fontWeight: 'bold' }}
            />
          ))}

          {/* ป้ายข้อมูล Fibonacci (แสดงจุดสูงสุด/ต่ำสุดที่ใช้คำนวณ) */}
          {visible.fib && fibonacci && (
            <ReferenceDot
              yAxisId="left"
              x={data[0]?.date}
              y={fibonacci.high}
              r={0}  // ไม่แสดงจุด แค่แสดง label
              label={{
                value: `Fib High: ${formatPriceTick(fibonacci.high)} | Low: ${formatPriceTick(fibonacci.low)}`,
                position: 'insideTopLeft',
                fill: '#e0e0e0',
                fontSize: 10,
                offset: 10
              }}
            />
          )}

          {/* === Golden/Death Cross Background Zones (โซนพื้นหลัง) === */}
          {/* โซนสีทอง = Golden Cross (Bullish), โซนสีเทา = Death Cross (Bearish) */}
          {visible.goldenDeath && goldenDeathZones.map((zone, i) => (
            <ReferenceArea
              key={`gd-zone-${i}`}
              yAxisId="left"
              x1={zone.start}
              x2={zone.end}
              fill={zone.type === 'golden' ? '#ffd70020' : '#b0bec520'}  // ทองอ่อน/เทาอ่อน
              fillOpacity={0.3}
            />
          ))}

          {/* === Golden/Death Cross Signals (สัญญาณสำคัญ) === */}
          {/* แสดงเป็นรูปสามเหลี่ยม: สามเหลี่ยมชี้ขึ้น = Golden, สามเหลี่ยมชี้ลง = Death */}
          {visible.goldenDeath && goldenDeathSignals.map((s, i) => {
            const hasPoint = data?.some(d => d.date === s.date);
            if (!hasPoint) return null;
            return (
              <ReferenceDot
                key={`gd-${i}-${s.date}`}
                yAxisId="left"
                x={s.date}
                y={s.price}
                r={12}  // ขนาดใหญ่เพราะสัญญาณสำคัญ
                fill={s.type === 'golden' ? '#00e676' : '#ff1744'}  // เขียวสด/แดงสด
                stroke="#fff"
                strokeWidth={2}
                shape={(props) => {
                  const { cx, cy, fill } = props;
                  // รูปสามเหลี่ยม: ชี้ขึ้น (Golden) หรือ ชี้ลง (Death)
                  const size = 10;
                  const isGolden = s.type === 'golden';

                  const points = isGolden
                    ? `${cx},${cy - size} ${cx + size},${cy + size} ${cx - size},${cy + size}` // สามเหลี่ยมชี้ขึ้น
                    : `${cx - size},${cy - size} ${cx + size},${cy - size} ${cx},${cy + size}`; // สามเหลี่ยมชี้ลง

                  return (
                    <g>
                      <polygon points={points} fill={fill} stroke="#ffffff" strokeWidth="2" />
                      <text x={cx} y={cy} dy={isGolden ? 30 : -30} textAnchor="middle" fill={fill} fontSize={12} fontWeight="bold" style={{ textShadow: '0 0 3px #000' }}>
                        {isGolden ? 'GOLDEN' : 'DEATH'}
                      </text>
                    </g>
                  );
                }}
              />
            );
          })}

          {/* === RSI Cross Signals (สัญญาณ RSI ทะลุเขต 30/70) === */}
          {/* B = Buy (RSI ทะลุขึ้นผ่าน 30), S = Sell (RSI ทะลุลงผ่าน 70) */}
          {signals.map(s => {
            const pt = data?.find(d => d.date === s.date);
            if (!pt) return null;
            return (
              <ReferenceDot
                key={s.date + s.type}
                yAxisId="left"
                x={s.date}
                y={pt.close}
                r={7}
                fill={s.type === 'buy' ? '#43a047' : '#e53935'}  // เขียว = Buy, แดง = Sell
                stroke="#fff"
                label={{ value: s.type === 'buy' ? 'B' : 'S', fill: '#fff', fontSize: 10, textAnchor: 'middle', dy: 4 }}
              />
            );
          })}

          {/* === SMA Cross Signals (สัญญาณ SMA ตัดกัน) === */}
          {/* เช่น SMA 50 ตัด SMA 200 = Golden/Death Cross */}
          {visible.sma && smaSignals.map((s, i) => {
            const pt = data?.find(d => d.date === s.date);
            if (!pt) return null;
            const isGoldenPair = s.pair === '50/200';  // คู่ 50/200 สำคัญที่สุด
            const fill = isGoldenPair
              ? (s.kind === 'bull' ? '#ffd700' : '#b0bec5')  // ทอง/เทา สำหรับ 50/200
              : (s.kind === 'bull' ? '#43a047' : '#e53935'); // เขียว/แดง สำหรับคู่อื่น
            const lbl = isGoldenPair
              ? (s.kind === 'bull' ? 'Golden' : 'Death')
              : `${s.pair} ${s.kind === 'bull' ? '+' : '−'}`;
            const radius = isGoldenPair ? 8 : 6;
            return <ReferenceDot key={`sma-${i}-${s.date}-${s.pair}`} yAxisId="left" x={s.date} y={pt.close} r={radius} fill={fill} stroke="#fff" label={{ value: lbl, fill: '#fff', fontSize: 10, textAnchor: 'middle', dy: 4 }} />;
          })}

          {/* === MACD Strategy Signals (สัญญาณจาก MACD) === */}
          {/* MACD Line ตัด Signal Line */}
          {visible.macd && macdStrategySignals.map((s, i) => {
            const pt = data?.find(d => d.date === s.date);
            if (!pt) return null;
            const fill = s.type === 'buy' ? '#00c853' : '#ff3d00';  // เขียวสด/ส้มแดง
            const label = s.type === 'buy' ? 'MACD Buy' : 'MACD Sell';
            return <ReferenceDot key={`macd-strat-${i}-${s.date}`} yAxisId="left" x={s.date} y={pt.close} r={9} fill={fill} stroke="#fff" label={{ value: label, fill: '#fff', fontSize: 10, textAnchor: 'middle', dy: 4 }} />;
          })}

          {/* === Overbought/Oversold Markers (จุดทะลุ Bollinger Bands) === */}
          {/* OB = Overbought (ราคาแพงเกินไป), OS = Oversold (ราคาถูกเกินไป) */}
          {visible.bb && obos.map((o, i) => (
            <ReferenceDot
              key={`ob-${i}-${o.date}`}
              yAxisId="left"
              x={o.date}
              y={o.value}
              r={6}
              fill={o.type === 'overbought' ? '#e53935' : '#43a047'}  // แดง = OB, เขียว = OS
              stroke="#fff"
              label={{ value: o.type === 'overbought' ? 'OB' : 'OS', fill: '#fff', fontSize: 10, textAnchor: 'middle', dy: 4 }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});