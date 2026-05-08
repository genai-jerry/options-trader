/**
 * Indian tax + Zerodha charges for F&O and equity trades.
 *
 * Rate constants are pinned to a review date (TAX_RATES_REVIEWED_AT). When
 * the rates change — new STT post-Budget, GST tweak, etc. — bump that
 * date and update the table. Income tax slabs change at most yearly with
 * the Union Budget, the F&O charges changed once on 2024-10-01 (STT
 * options-sell 0.0625% → 0.1%, futures-sell 0.0125% → 0.02%). No free
 * structured API exists for these — the source URL points at the
 * canonical broker page used to verify each release.
 *
 * Income tax model: F&O is non-speculative business income (Section
 * 43(5)(d)) so it's taxed at the individual's slab rate, not a flat
 * STCG/LTCG rate. The selector exposes the standard new-regime brackets
 * (0/5/10/15/20/30), with a 4% health & education cess on top. Real
 * liability is annual, after offsetting losses, deductions, and other
 * income — these helpers produce a per-window estimate, not a tax filing.
 */

export const TAX_RATES_REVIEWED_AT = '2026-05-08';
export const TAX_RATES_SOURCE_URL = 'https://zerodha.com/charges/';

export type TaxSegment = 'option' | 'future' | 'equity-delivery' | 'equity-intraday';

interface SegmentRates {
  stt: number;
  /** True for equity-delivery (both sides); else STT applies on SELL only. */
  sttBothSides: boolean;
  exchange: number;
  /** Stamp duty applies on BUY only. */
  stamp: number;
  hasBrokerage: boolean;
}

const RATES: Record<TaxSegment, SegmentRates> = {
  option: {
    stt: 0.001,
    sttBothSides: false,
    exchange: 0.0003503,
    stamp: 0.00003,
    hasBrokerage: true,
  },
  future: {
    stt: 0.0002,
    sttBothSides: false,
    exchange: 0.000019,
    stamp: 0.00002,
    hasBrokerage: true,
  },
  'equity-intraday': {
    stt: 0.00025,
    sttBothSides: false,
    exchange: 0.0000297,
    stamp: 0.00003,
    hasBrokerage: true,
  },
  'equity-delivery': {
    stt: 0.001,
    sttBothSides: true,
    exchange: 0.0000297,
    stamp: 0.00015,
    hasBrokerage: false,
  },
};

const SEBI_RATE = 0.000001; // ₹10 per crore turnover, both sides
const GST_RATE = 0.18;
const BROKERAGE_PER_ORDER = 20;
const CESS_MULTIPLIER = 1.04;

export interface OrderCharges {
  stt: number;
  exchange: number;
  sebi: number;
  stamp: number;
  brokerage: number;
  gst: number;
}

const ZERO: OrderCharges = {
  stt: 0,
  exchange: 0,
  sebi: 0,
  stamp: 0,
  brokerage: 0,
  gst: 0,
};

export interface ChargesBreakdown extends OrderCharges {
  total: number;
}

export interface FillForCharges {
  segment: TaxSegment;
  side: 'BUY' | 'SELL';
  /** quantity × price-per-unit, in rupees. */
  turnover: number;
}

export interface OrderForBrokerage {
  segment: TaxSegment;
}

export function classifyByMeta(opts: {
  tradingsymbol: string;
  exchange: string;
  product?: string | null | undefined;
}): TaxSegment {
  const sym = (opts.tradingsymbol ?? '').toUpperCase();
  const exch = (opts.exchange ?? '').toUpperCase();
  const prod = (opts.product ?? '').toUpperCase();
  if (
    exch === 'NFO' ||
    exch === 'BFO' ||
    exch === 'CDS' ||
    exch === 'BCD' ||
    exch === 'MCX'
  ) {
    if (sym.endsWith('CE') || sym.endsWith('PE')) return 'option';
    return 'future';
  }
  return prod === 'MIS' ? 'equity-intraday' : 'equity-delivery';
}

function feesForFill(fill: FillForCharges): Omit<OrderCharges, 'brokerage' | 'gst'> {
  const r = RATES[fill.segment];
  const sttApplies = r.sttBothSides || fill.side === 'SELL';
  return {
    stt: sttApplies ? fill.turnover * r.stt : 0,
    exchange: fill.turnover * r.exchange,
    sebi: fill.turnover * SEBI_RATE,
    stamp: fill.side === 'BUY' ? fill.turnover * r.stamp : 0,
  };
}

export function aggregateCharges(
  fills: FillForCharges[],
  brokerageOrders: OrderForBrokerage[],
): ChargesBreakdown {
  const t: OrderCharges = { ...ZERO };
  for (const f of fills) {
    const c = feesForFill(f);
    t.stt += c.stt;
    t.exchange += c.exchange;
    t.sebi += c.sebi;
    t.stamp += c.stamp;
  }
  for (const o of brokerageOrders) {
    if (RATES[o.segment].hasBrokerage) t.brokerage += BROKERAGE_PER_ORDER;
  }
  t.gst = (t.brokerage + t.exchange + t.sebi) * GST_RATE;
  return {
    ...t,
    total: t.stt + t.exchange + t.sebi + t.stamp + t.brokerage + t.gst,
  };
}

export interface TaxLiability {
  charges: ChargesBreakdown;
  realisedAfterCharges: number;
  effectiveRate: number;
  incomeTax: number;
  realisedAfterAll: number;
}

export function computeTaxLiability(
  fills: FillForCharges[],
  brokerageOrders: OrderForBrokerage[],
  grossRealised: number,
  slabPercent: number,
): TaxLiability {
  const charges = aggregateCharges(fills, brokerageOrders);
  const realisedAfterCharges = grossRealised - charges.total;
  const effectiveRate = (slabPercent / 100) * CESS_MULTIPLIER;
  const incomeTax =
    realisedAfterCharges > 0 ? realisedAfterCharges * effectiveRate : 0;
  return {
    charges,
    realisedAfterCharges,
    effectiveRate,
    incomeTax,
    realisedAfterAll: realisedAfterCharges - incomeTax,
  };
}

export const SLAB_OPTIONS = [0, 5, 10, 15, 20, 30] as const;
export const SLAB_STORAGE_KEY = 'options-trader.zerodha.taxSlab';

/**
 * First day of the current Indian financial year (Apr 1 → Mar 31), as
 * YYYY-MM-DD. April through December → current calendar year; Jan–March
 * → previous calendar year.
 */
export function startOfCurrentFY(today: Date = new Date()): string {
  const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return `${year}-04-01`;
}

/**
 * FIFO P&L across an arbitrary date range. Handles both long-then-flat
 * and short-then-flat sequences (an opening SELL adds to the short queue;
 * a later BUY closes against it). Returns rupees.
 *
 * Cross-day matching is essential here — per-day matching, which works
 * for intraday F&O, would miss every overnight position.
 */
export interface FifoFill {
  tradingsymbol: string;
  exchange: string;
  transactionType: 'BUY' | 'SELL';
  quantity: number;
  pricePerUnitRupees: number;
  /** Used for chronological sorting. */
  sortKey: string;
}

export function computeRealisedFifo(fills: FifoFill[]): number {
  const bySymbol = new Map<string, FifoFill[]>();
  for (const f of fills) {
    const key = `${f.exchange}:${f.tradingsymbol}`;
    let arr = bySymbol.get(key);
    if (!arr) {
      arr = [];
      bySymbol.set(key, arr);
    }
    arr.push(f);
  }

  let realised = 0;
  for (const items of bySymbol.values()) {
    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const longs: { qty: number; price: number }[] = [];
    const shorts: { qty: number; price: number }[] = [];

    for (const t of items) {
      let remaining = t.quantity;
      const opposing = t.transactionType === 'BUY' ? shorts : longs;
      const own = t.transactionType === 'BUY' ? longs : shorts;

      while (remaining > 0 && opposing.length > 0) {
        const head = opposing[0]!;
        const matched = Math.min(remaining, head.qty);
        const sellPrice =
          t.transactionType === 'SELL' ? t.pricePerUnitRupees : head.price;
        const buyPrice =
          t.transactionType === 'BUY' ? t.pricePerUnitRupees : head.price;
        realised += matched * (sellPrice - buyPrice);
        head.qty -= matched;
        remaining -= matched;
        if (head.qty === 0) opposing.shift();
      }

      if (remaining > 0) {
        own.push({ qty: remaining, price: t.pricePerUnitRupees });
      }
    }
  }

  return realised;
}
