import { describe, expect, it } from 'vitest';
import { isValidTimeZone, safeTimeZone } from '@pharmaiq/core';

describe('fuseaux horaires', () => {
  it('reconnaît un fuseau IANA', () => {
    expect(isValidTimeZone('Africa/Djibouti')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejette un nom inconnu, vide ou d’un autre type', () => {
    expect(isValidTimeZone('Djibouti/Centre-ville')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(3)).toBe(false);
  });

  it('retombe sur UTC plutôt que de transmettre un fuseau invalide à la base', () => {
    expect(safeTimeZone('Africa/Djibouti')).toBe('Africa/Djibouti');
    expect(safeTimeZone("'; drop table")).toBe('UTC');
  });
});
