// Reads money amounts like "$55-65/hr", "€4,500 per month" or "70 USD an hour". No AI here.
// Used for the Step 6 "rate far above range" check (and later Step 7's "rate confirmed").

export type Rate = { low: number; high: number; currency: string | null; period: "hour" | "day" | "month" | "year" | null };

const CURRENCIES: [RegExp, string][] = [
  [/\$|\busd\b|dollars?/i, "USD"],
  [/€|\beur\b|euros?/i, "EUR"],
  [/£|\bgbp\b/i, "GBP"],
  [/\bpln\b|zł|zloty/i, "PLN"],
  [/₴|\buah\b|hryvn/i, "UAH"],
];
const PERIODS: [RegExp, Rate["period"]][] = [
  [/\/\s*h(ou)?r?\b|per hour|an hour|hourly|\bph\b/i, "hour"],
  [/\/\s*day\b|per day|a day|daily/i, "day"],
  [/\/\s*mo(nth)?\b|per month|a month|monthly|\bmth\b/i, "month"],
  [/\/\s*y(ea)?r\b|per year|a year|annual|per annum|yearly/i, "year"],
];

export const currencyOf = (text: string) => CURRENCIES.find(([re]) => re.test(text))?.[1] ?? null;
export const periodOf = (text: string) => PERIODS.find(([re]) => re.test(text))?.[1] ?? null;

export function parseRate(text: string | null | undefined): Rate | null {
  if (!text) return null;
  const nums = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/gi)]
    .map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1))
    .filter((n) => n > 0);
  if (!nums.length) return null;
  const b = nums[1];
  const a = b !== undefined && b >= 1000 && nums[0] < 100 && /\dk\b/i.test(text) ? nums[0] * 1000 : nums[0]; // "4-5k" = 4,000-5,000
  return {
    low: Math.min(a, b ?? a),
    high: Math.max(a, b ?? a),
    currency: currencyOf(text),
    period: periodOf(text),
  };
}

// How far the candidate's rate is above the top of the range (0.4 = 40% above), or null if the two can't be
// compared (missing, or different currency / period). A candidate range counts from its lower end.
export function rateAboveRange(candidateRate: string | null | undefined, rateRange: string | null | undefined): number | null {
  const c = parseRate(candidateRate);
  const r = parseRate(rateRange);
  if (!c || !r) return null;
  if (c.currency && r.currency && c.currency !== r.currency) return null;
  if (c.period && r.period && c.period !== r.period) return null;
  return c.low / r.high - 1;
}

// One amount in the range's own format: rateLike("$55-65/hr", 60) -> "$60/hr". For the test scripts' sample answers.
export function rateLike(rateRange: string, value: number): string {
  const rounded = Math.round(value);
  const range = rateRange.match(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:-|–|to)\s*[$€£]?\s*(\d[\d,]*(?:\.\d+)?)(k)?/i);
  if (range) return rateRange.replace(range[0], String(rounded));
  return rateRange.replace(/(\d[\d,]*(?:\.\d+)?)/, String(rounded));
}
