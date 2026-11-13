import { describe, it, expect } from 'vitest';
import { EthiopianCalendar } from '../../src/domain/localization/ethiopian-calendar.js';

describe('EthiopianCalendar Converter', () => {
  it('converts Gregorian dates to Ethiopian calendar accurately', () => {
    // Sept 11, 2024 is Meskerem 1, 2017
    const enkutatash = new Date(Date.UTC(2024, 8, 11));
    const ethDate = EthiopianCalendar.fromGregorian(enkutatash);

    expect(ethDate.year).toBe(2017);
    expect(ethDate.month).toBe(1);
    expect(ethDate.day).toBe(1);
    expect(ethDate.monthNameAmharic).toBe('መስከረም');
    expect(ethDate.formattedAmharic).toBe('01 መስከረም 2017 ዓ.ም');
  });

  it('accurately identifies Ethiopian leap years and Pagume length', () => {
    // 2015 % 4 = 3 -> Leap year (Pagume has 6 days)
    expect(EthiopianCalendar.isEthiopianLeapYear(2015)).toBe(true);
    // 2016 % 4 = 0 -> Regular year
    expect(EthiopianCalendar.isEthiopianLeapYear(2016)).toBe(false);
  });

  it('performs exact round-trip conversions (Gregorian -> Ethiopian -> Gregorian)', () => {
    const testDates = [
      new Date(Date.UTC(2023, 0, 7)),   // Jan 7, 2023
      new Date(Date.UTC(2024, 4, 1)),   // May 1, 2024
      new Date(Date.UTC(2025, 8, 11)),  // Sept 11, 2025
      new Date(Date.UTC(2026, 10, 13)), // Nov 13, 2026 (current date)
    ];

    for (const originalDate of testDates) {
      const eth = EthiopianCalendar.fromGregorian(originalDate);
      const convertedBack = EthiopianCalendar.toGregorian(eth.year, eth.month, eth.day);

      expect(convertedBack.getUTCFullYear()).toBe(originalDate.getUTCFullYear());
      expect(convertedBack.getUTCMonth()).toBe(originalDate.getUTCMonth());
      expect(convertedBack.getUTCDate()).toBe(originalDate.getUTCDate());
    }
  });

  it('calculates current date in Ethiopian calendar', () => {
    const today = new Date(Date.UTC(2026, 10, 13)); // 2026-11-13
    const eth = EthiopianCalendar.fromGregorian(today);
    expect(eth.year).toBe(2019);
    expect(eth.month).toBe(3); // Hidar
    expect(eth.day).toBe(4);
    expect(eth.monthNameAmharic).toBe('ህዳር');
    expect(eth.formattedAmharic).toBe('04 ህዳር 2019 ዓ.ም');
  });
});
