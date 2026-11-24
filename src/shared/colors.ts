export const colorFamilies = [
  {
    id: 'red',
    label: '红色',
    swatch: '#db4e56',
  },
  {
    id: 'orange',
    label: '橙色',
    swatch: '#e58a3b',
  },
  {
    id: 'yellow',
    label: '黄色',
    swatch: '#d8bf4b',
  },
  {
    id: 'green',
    label: '绿色',
    swatch: '#56a46b',
  },
  {
    id: 'cyan',
    label: '青色',
    swatch: '#4da7a8',
  },
  {
    id: 'blue',
    label: '蓝色',
    swatch: '#5589cc',
  },
  {
    id: 'purple',
    label: '紫色',
    swatch: '#956cc5',
  },
  {
    id: 'pink',
    label: '粉色',
    swatch: '#d77ba4',
  },
  {
    id: 'brown',
    label: '棕色',
    swatch: '#8a6142',
  },
  {
    id: 'neutral',
    label: '黑白灰',
    swatch: '#929b9e',
  },
] as const;
export type ColorFamily = (typeof colorFamilies)[number]['id'];
export function hexToHSL(hex: string): {
  h: number;
  s: number;
  l: number;
} | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map(
      (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
    ),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2;
  if (!d)
    return {
      h: 0,
      s: 0,
      l: l * 100,
    };
  const hue =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return {
    h: hue * 60,
    s: (d / (1 - Math.abs(2 * l - 1))) * 100,
    l: l * 100,
  };
}
export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const a = s * Math.min(l, 1 - l),
    f = (n: number) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
  return (
    '#' +
    [f(0), f(8), f(4)]
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function colorFamily(hex: unknown): ColorFamily | null {
  const c = typeof hex === 'string' ? hexToHSL(hex) : null;
  if (!c) return null;
  if (c.s < 15 || c.l < 9 || c.l > 94) return 'neutral';
  if (c.h >= 12 && c.h < 65 && c.l < 43) return 'brown';
  if (c.h < 15 || c.h >= 345) return 'red';
  if (c.h < 45) return 'orange';
  if (c.h < 70) return 'yellow';
  if (c.h < 165) return 'green';
  if (c.h < 200) return 'cyan';
  if (c.h < 255) return 'blue';
  if (c.h < 295) return 'purple';
  return 'pink';
}
export function paletteMatches(
  colors: readonly string[],
  family?: ColorFamily,
) {
  return !family || colors.some((c) => colorFamily(c) === family);
}
