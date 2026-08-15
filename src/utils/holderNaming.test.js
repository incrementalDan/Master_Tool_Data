// A holder has ONE name: its description. The short form ("30-SK13-60" for
// "NBT30-SK13C-60") is retired — nothing composes it any more — but names
// ALREADY STORED still carry it and are deliberately not being rewritten, so
// matching has to keep recognising it.
import { describe, it, expect } from 'vitest';
import { holderNameToken, holderTokensMatch } from './holderNaming.js';

describe('holderNameToken', () => {
  it('is the description, verbatim', () => {
    expect(holderNameToken('NBT30-SK13C-60')).toBe('NBT30-SK13C-60');
    expect(holderNameToken('NBT30-SK20C-90')).toBe('NBT30-SK20C-90');
  });

  it('keeps an extension suffix, like everything else', () => {
    expect(holderNameToken('NBT30-SK13C-60 w/ER16 EXT 2.2OOH'))
      .toBe('NBT30-SK13C-60 w/ER16 EXT 2.2OOH');
  });

  it('does not abbreviate, re-case or re-spell anything', () => {
    expect(holderNameToken('nbt30-SK13C-60')).toBe('nbt30-SK13C-60');
    expect(holderNameToken('BBT30-CKB3-79 (For EWN Boring Heads)'))
      .toBe('BBT30-CKB3-79 (For EWN Boring Heads)');
  });

  it('returns empty string for a blank description', () => {
    expect(holderNameToken('')).toBe('');
    expect(holderNameToken(null)).toBe('');
    expect(holderNameToken(undefined)).toBe('');
  });

  it('trims', () => {
    expect(holderNameToken('  NBT30-SK13C-60  ')).toBe('NBT30-SK13C-60');
  });
});

// ⚠️ This is a comparison tolerance, never a name generator. It exists so a
// preset whose stored name uses the old short form still seeds its assembly FK.
describe('holderTokensMatch', () => {
  it('matches the retired short form against the description', () => {
    expect(holderTokensMatch('30-SK13-60', 'NBT30-SK13C-60')).toBe(true);
    expect(holderTokensMatch('NBT30-SK13C-60', '30-SK13-60')).toBe(true);
  });

  it('matches a description against itself', () => {
    expect(holderTokensMatch('NBT30-SK13C-60', 'NBT30-SK13C-60')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(holderTokensMatch('nbt30-sk13c-60', 'NBT30-SK13C-60')).toBe(true);
  });

  it('keeps an extension suffix significant', () => {
    expect(holderTokensMatch('30-SK13-60 w/ER16 EXT 2.2OOH', 'NBT30-SK13C-60')).toBe(false);
    expect(holderTokensMatch('30-SK13-60 w/ER16 EXT 2.2OOH', 'NBT30-SK13C-60 w/ER16 EXT 2.2OOH'))
      .toBe(true);
  });

  it('does not match two different holders', () => {
    expect(holderTokensMatch('30-SK20-90', 'NBT30-SK13C-60')).toBe(false);
    expect(holderTokensMatch('NBT30-SK13C-60', 'NBT30-SK13C-90')).toBe(false);
  });

  it('never matches on a blank', () => {
    expect(holderTokensMatch('', 'NBT30-SK13C-60')).toBe(false);
    expect(holderTokensMatch('NBT30-SK13C-60', null)).toBe(false);
    expect(holderTokensMatch('', '')).toBe(false);
  });
});
