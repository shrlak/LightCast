// Format Background fills (area: pictures-insert).
import { describe, expect, it } from 'vitest';
import { gradientCss, hexOf, parseGradient, transparencyOf, withTransparency } from '../src/domain/backgroundFormat';

describe('Format Background', () => {
  it('solid colour with transparency round-trips', () => {
    expect(withTransparency('#1f8a52', 0)).toBe('#1f8a52');
    const c = withTransparency('#1f8a52', 0.4);
    expect(c).toBe('rgba(31, 138, 82, 0.6)');
    expect(transparencyOf(c)).toBe(0.4);
    expect(hexOf(c)).toBe('#1f8a52');
    expect(transparencyOf('#1f8a52')).toBe(0);
  });
  it('gradient round-trips linear angle and radial', () => {
    const g = { type: 'linear' as const, angle: 45, from: '#112233', to: '#ffeedd' };
    expect(gradientCss(g)).toBe('linear-gradient(135deg, #112233 0%, #ffeedd 100%)');
    expect(parseGradient(gradientCss(g))).toEqual(g);
    const r = { type: 'radial' as const, angle: 0, from: '#000000', to: '#ffffff' };
    expect(parseGradient(gradientCss(r))).toEqual(r);
    expect(parseGradient('url(x)')).toBeNull();
  });
});
