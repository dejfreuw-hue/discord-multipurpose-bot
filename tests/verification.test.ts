import { describe, expect, it } from 'vitest';
import { codeMatches, generateCode, renderCaptcha } from '../src/modules/community/verification/captcha.js';

describe('captcha', () => {
  it('generates codes without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toMatch(/^[A-Z2-9]{5}$/);
      expect(code).not.toMatch(/[0O1I5S]/);
    }
  });

  it('accepts answers regardless of case and spaces', () => {
    expect(codeMatches('K7PWD', 'k7pwd')).toBe(true);
    expect(codeMatches('K7PWD', ' K7 PWD ')).toBe(true);
    expect(codeMatches('K7PWD', 'K7PW')).toBe(false);
  });

  it('renders a PNG', () => {
    expect(renderCaptcha('K7PWD').subarray(1, 4).toString()).toBe('PNG');
  });
});
