import { expect, test } from 'vitest';
import { dateTimeLocalValue, dateTimeLocalToISO } from './dates';

test('unknown or damaged card dates cannot crash the date editor', () => {
  for (const value of [null, undefined, '', 'invalid-date', '2026-99-99', '+999999-12-31T00:00:00Z']) expect(dateTimeLocalValue(value)).toBe('');
});

test('card date editing preserves local wall time and converts back to UTC', () => {
  const input = '2026-11-19T08:35';
  const iso = dateTimeLocalToISO(input);
  expect(iso).toBe(new Date(input).toISOString());
  expect(dateTimeLocalValue(iso)).toBe(input);
});

test('clearing or entering an invalid date does not call toISOString on an invalid Date', () => {
  expect(dateTimeLocalToISO('')).toBeNull();
  expect(dateTimeLocalToISO('bad')).toBeNull();
});
