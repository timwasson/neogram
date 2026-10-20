export type CounterStyle = 'green_led' | 'red_nixie' | 'odometer' | 'blue_vfd';

interface CounterTheme {
  outerBg: string;
  outerBorder: string;
  boxBg: string;
  boxBorder: string;
  digitColor: string;
  glowColor: string;
  hasGlow: boolean;
}

const THEMES: Record<CounterStyle, CounterTheme> = {
  green_led: {
    outerBg: '#051405',
    outerBorder: '#00ff66',
    boxBg: '#0b260b',
    boxBorder: '#144214',
    digitColor: '#00ff66',
    glowColor: '#00ff66',
    hasGlow: true,
  },
  red_nixie: {
    outerBg: '#1e0502',
    outerBorder: '#ff3300',
    boxBg: '#360904',
    boxBorder: '#55120a',
    digitColor: '#ff4400',
    glowColor: '#ff3300',
    hasGlow: true,
  },
  odometer: {
    outerBg: '#111111',
    outerBorder: '#888888',
    boxBg: '#000000',
    boxBorder: '#333333',
    digitColor: '#ffffff',
    glowColor: 'transparent',
    hasGlow: false,
  },
  blue_vfd: {
    outerBg: '#02141a',
    outerBorder: '#00ffff',
    boxBg: '#04232c',
    boxBorder: '#083c4b',
    digitColor: '#00ffff',
    glowColor: '#00ffff',
    hasGlow: true,
  },
};

/**
 * Generates an SVG representation of a retro digital web hit counter.
 * Pure SVG, zero external assets, scales crisp across any device.
 */
export function generateCounterSvg(hits: number, styleName: string = 'green_led'): string {
  const style: CounterStyle = (styleName in THEMES) ? (styleName as CounterStyle) : 'green_led';
  const theme = THEMES[style];

  // Format hit count to 6 digits (e.g. 042981)
  const safeHits = Math.max(0, Math.floor(hits));
  const digits = safeHits.toString().padStart(6, '0').slice(-6).split('');

  const digitWidth = 24;
  const digitHeight = 36;
  const gap = 4;
  const paddingX = 8;
  const paddingY = 6;

  const totalWidth = paddingX * 2 + (digitWidth * 6) + (gap * 5); // 8*2 + 144 + 20 = 180
  const totalHeight = paddingY * 2 + digitHeight; // 12 + 36 = 48

  let boxesSvg = '';
  digits.forEach((d, idx) => {
    const x = paddingX + idx * (digitWidth + gap);
    const y = paddingY;
    const centerX = x + digitWidth / 2;
    const centerY = y + digitHeight / 2 + 1; // optical baseline tweak

    boxesSvg += `
      <!-- Digit ${idx + 1} (${d}) -->
      <g>
        <rect x="${x}" y="${y}" width="${digitWidth}" height="${digitHeight}" rx="2" fill="${theme.boxBg}" stroke="${theme.boxBorder}" stroke-width="1.5" />
        <line x1="${x}" y1="${y + digitHeight / 2}" x2="${x + digitWidth}" y2="${y + digitHeight / 2}" stroke="${theme.boxBorder}" stroke-width="0.75" opacity="0.4" />
        <text x="${centerX}" y="${centerY}" 
              text-anchor="middle" 
              dominant-baseline="central" 
              font-family="'Courier New', Courier, 'Lucida Console', Monaco, monospace" 
              font-size="22" 
              font-weight="bold" 
              fill="${theme.digitColor}"
              ${theme.hasGlow ? 'filter="url(#glowFilter)"' : ''}>${d}</text>
      </g>
    `;
  });

  const glowDef = theme.hasGlow
    ? `<filter id="glowFilter" x="-20%" y="-20%" width="140%" height="140%">
         <feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="${theme.glowColor}" flood-opacity="0.8" />
       </filter>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" role="img" aria-label="Web Hit Counter: ${digits.join('')}">
  <defs>
    ${glowDef}
    <linearGradient id="bevelGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.15" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.3" />
    </linearGradient>
  </defs>

  <!-- Outer Shell -->
  <rect x="1" y="1" width="${totalWidth - 2}" height="${totalHeight - 2}" rx="3" fill="${theme.outerBg}" stroke="${theme.outerBorder}" stroke-width="2" />
  <rect x="2" y="2" width="${totalWidth - 4}" height="${totalHeight - 4}" rx="2" fill="url(#bevelGrad)" pointer-events="none" />

  <!-- Digits -->
  ${boxesSvg}
</svg>`;
}
