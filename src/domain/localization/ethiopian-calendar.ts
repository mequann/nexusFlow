/**
 * Ethiopian Calendar (Ge'ez / ዘመነ ግዕዝ) Mathematical Converter
 * 
 * Provides exact, drift-free bi-directional conversion between the Gregorian Calendar
 * and the Ethiopian Calendar (12 months of 30 days + 13th month 'Pagume' of 5 or 6 days).
 */

export interface EthiopianDate {
  year: number;
  month: number; // 1 - 13
  day: number;   // 1 - 30 (1 - 6 for Pagume)
  monthNameAmharic: string;
  monthNameEnglish: string;
  formattedAmharic: string; // e.g. "04 ህዳር 2019 ዓ.ም"
  formattedShort: string;   // e.g. "2019-03-04"
}

export const ETHIOPIAN_MONTHS_AMHARIC = [
  'መስከረም', // 1: Meskerem (Sep/Oct)
  'ጥቅምት',  // 2: Tikimt (Oct/Nov)
  'ህዳር',    // 3: Hidar (Nov/Dec)
  'ታህሳስ',  // 4: Tahsas (Dec/Jan)
  'ጥር',     // 5: Tir (Jan/Feb)
  'የካቲት',  // 6: Yekatit (Feb/Mar)
  'መጋቢት',  // 7: Megabit (Mar/Apr)
  'ሚያዝያ',  // 8: Miazia (Apr/May)
  'ግንቦት',  // 9: Ginbot (May/Jun)
  'ሰኔ',     // 10: Sene (Jun/Jul)
  'ሐምሌ',    // 11: Hamle (Jul/Aug)
  'ነሐሴ',    // 12: Nehase (Aug/Sep)
  'ጳጉሜ',    // 13: Pagume (Sep)
] as const;

export const ETHIOPIAN_MONTHS_ENGLISH = [
  'Meskerem',
  'Tikimt',
  'Hidar',
  'Tahsas',
  'Tir',
  'Yekatit',
  'Megabit',
  'Miazia',
  'Ginbot',
  'Sene',
  'Hamle',
  'Nehase',
  'Pagume',
] as const;

// Anchor point: 2023-09-12 00:00:00 UTC corresponds to Meskerem 1, 2016 ዓ.ም (01-01-2016)
const ANCHOR_ETH_YEAR = 2016;
const ANCHOR_UTC_MS = Date.UTC(2023, 8, 12);
const ONE_DAY_MS = 86_400_000;

export class EthiopianCalendar {
  /**
   * Checks if an Ethiopian year is a leap year (6 days in Pagume).
   * In the Ethiopian calendar, leap year occurs every 4 years when (year % 4 === 3).
   */
  public static isEthiopianLeapYear(year: number): boolean {
    return (year % 4) === 3;
  }

  /**
   * Returns total days in an Ethiopian year (366 for leap years, 365 otherwise).
   */
  public static getDaysInYear(year: number): number {
    return this.isEthiopianLeapYear(year) ? 366 : 365;
  }

  /**
   * Converts a standard JavaScript Date (Gregorian) to an EthiopianDate object.
   */
  public static fromGregorian(date: Date = new Date()): EthiopianDate {
    const targetMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    let diffDays = Math.round((targetMs - ANCHOR_UTC_MS) / ONE_DAY_MS);

    let year = ANCHOR_ETH_YEAR;
    if (diffDays >= 0) {
      while (diffDays >= this.getDaysInYear(year)) {
        diffDays -= this.getDaysInYear(year);
        year++;
      }
    } else {
      while (diffDays < 0) {
        year--;
        diffDays += this.getDaysInYear(year);
      }
    }

    const month = Math.floor(diffDays / 30) + 1;
    const day = (diffDays % 30) + 1;

    const monthIndex = Math.max(0, Math.min(month - 1, 12));
    const monthNameAmharic: string = ETHIOPIAN_MONTHS_AMHARIC[monthIndex] ?? 'መስከረም';
    const monthNameEnglish: string = ETHIOPIAN_MONTHS_ENGLISH[monthIndex] ?? 'Meskerem';

    const paddedDay = day < 10 ? `0${day}` : `${day}`;
    const paddedMonth = month < 10 ? `0${month}` : `${month}`;

    return {
      year,
      month,
      day,
      monthNameAmharic,
      monthNameEnglish,
      formattedAmharic: `${paddedDay} ${monthNameAmharic} ${year} ዓ.ም`,
      formattedShort: `${year}-${paddedMonth}-${paddedDay}`,
    };
  }

  /**
   * Converts an Ethiopian year, month, day back to a standard JavaScript Date (Gregorian, UTC midnight).
   */
  public static toGregorian(year: number, month: number, day: number): Date {
    let diffDays = 0;
    if (year >= ANCHOR_ETH_YEAR) {
      for (let y = ANCHOR_ETH_YEAR; y < year; y++) {
        diffDays += this.getDaysInYear(y);
      }
    } else {
      for (let y = year; y < ANCHOR_ETH_YEAR; y++) {
        diffDays -= this.getDaysInYear(y);
      }
    }

    diffDays += (month - 1) * 30 + (day - 1);
    return new Date(ANCHOR_UTC_MS + diffDays * ONE_DAY_MS);
  }
}
