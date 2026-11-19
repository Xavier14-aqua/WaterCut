import { useEffect, useRef, useState } from 'react';
import { hexToHSL, hslToHex } from '../shared/colors';
export function PaletteEditor({
  colors,
  disabled = false,
  onChange
}: {
  colors: string[];
  disabled?: boolean;
  onChange: (colors: string[]) => void;
}) {
  const [selected, setSelected] = useState<number | null>(colors.length ? 0 : null),
    [hsl, setHSL] = useState(() => hexToHSL(colors[0] ?? '#4b9b8b')!),
    [hex, setHex] = useState(() => colors[0] ?? '#4b9b8b');
  const wheel = useRef<HTMLDivElement>(null),
    pointer = useRef<number | null>(null),
    preview = hslToHex(hsl.h, hsl.s, hsl.l);
  function update(next: typeof hsl) {
    setHSL(next);
    setHex(hslToHex(next.h, next.s, next.l));
  }
  function stop() {
    if (pointer.current !== null && wheel.current?.hasPointerCapture(pointer.current)) wheel.current.releasePointerCapture(pointer.current);
    pointer.current = null;
  }
  useEffect(() => {
    const value = selected === null ? null : colors[selected];
    if (value) {
      const c = hexToHSL(value);
      if (c) {
        setHSL(c);
        setHex(value);
      }
    } else if (selected !== null) setSelected(null);
  }, [colors, selected]);
  useEffect(() => {
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('blur', stop);
      stop();
    };
  }, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  function point(event: React.PointerEvent<HTMLDivElement>) {
    const r = event.currentTarget.getBoundingClientRect(),
      x = event.clientX - r.x - r.width / 2,
      y = event.clientY - r.y - r.height / 2;
    if (pointer.current === null && (Math.hypot(x, y) < r.width * .32 || Math.hypot(x, y) > r.width * .5)) return false;
    update({
      ...hsl,
      h: (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360
    });
    return true;
  }
  function apply() {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const next = selected === null ? [...colors, hex.toLowerCase()] : colors.map((c, i) => i === selected ? hex.toLowerCase() : c),
      unique = [...new Set(next.map(color => color.toLowerCase()))];
    onChange(unique);
    setSelected(unique.indexOf(hex.toLowerCase()));
  }
  return <div className="palette-editor"><span className="field-label">主色条</span><div className="palette-swatches" role="group" aria-label="主色条颜色">{colors.map((color, index) => <div className="palette-swatch-item" key={index}><button type="button" className={`palette-swatch ${selected === index ? 'active' : ''}`} style={{
          backgroundColor: color
        }} aria-label={`编辑主色 ${index + 1} ${color}`} aria-pressed={selected === index} disabled={disabled} onClick={() => setSelected(index)}>{selected === index && <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg>}</button><button type="button" className="quiet" aria-label={`移除主色 ${index + 1}`} disabled={disabled} onClick={() => {
          onChange(colors.filter((_, i) => i !== index));
          setSelected(null);
        }}>移除</button></div>)}<button type="button" className="secondary palette-new" disabled={disabled || colors.length >= 6} onClick={() => setSelected(null)}>新增颜色</button></div>
    <div className="color-wheel-layout"><div ref={wheel} className="color-wheel" role="slider" aria-label="色环色相" aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.round(hsl.h) % 360} aria-valuetext={`${Math.round(hsl.h) % 360} 度`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onPointerDown={event => {
        if (disabled || !event.isPrimary || event.button !== 0 || pointer.current !== null) return;
        if (point(event)) {
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }} onPointerMove={event => {
        if (pointer.current === event.pointerId) point(event);
      }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={() => {
        pointer.current = null;
      }} onKeyDown={event => {
        if (disabled) return;
        const step = event.shiftKey ? 10 : 1,
          delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : 0;
        if (delta || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          update({
            ...hsl,
            h: event.key === 'Home' ? 0 : event.key === 'End' ? 359 : (hsl.h + delta + 360) % 360
          });
        }
      }}><span className="wheel-center" style={{
          backgroundColor: preview
        }} /><span className="wheel-thumb" style={{
          left: `${50 + 42 * Math.sin(hsl.h * Math.PI / 180)}%`,
          top: `${50 - 42 * Math.cos(hsl.h * Math.PI / 180)}%`
        }} /></div>
      <div className="color-adjustments"><label>饱和度<input aria-label="颜色饱和度" type="range" min="0" max="100" value={hsl.s} disabled={disabled} onChange={e => update({
            ...hsl,
            s: Number(e.target.value)
          })} /></label><label>明度<input aria-label="颜色明度" type="range" min="0" max="100" value={hsl.l} disabled={disabled} onChange={e => update({
            ...hsl,
            l: Number(e.target.value)
          })} /></label><label>颜色值<input aria-label="颜色值" value={hex} maxLength={7} spellCheck={false} disabled={disabled} onChange={e => {
            setHex(e.target.value);
            const c = hexToHSL(e.target.value);
            if (c) setHSL(c);
          }} /></label><input type="color" className="system-color" aria-label="系统选色器" value={preview} disabled={disabled} onChange={e => {
          setHex(e.target.value);
          setHSL(hexToHSL(e.target.value)!);
        }} /></div></div>
    <button type="button" className="secondary" disabled={disabled || !/^#[0-9a-f]{6}$/i.test(hex) || selected === null && colors.length >= 6} onClick={apply}>{selected === null ? '加入主色条' : `替换第 ${selected + 1} 色`}</button><small className="muted">点击色环选色，再加入或替换；最多保留 6 种主色。</small>
  </div>;
}
