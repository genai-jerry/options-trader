/**
 * YTD tax/charge rollup for synced broker fills. Pulled out of the
 * Zerodha Sync page so the Dashboard can show the same numbers — both
 * views must agree on the formula or the user gets two different
 * "realistic" answers.
 *
 * `computeYtdSummary` filters to the current Indian FY (Apr 1 → Mar 31),
 * matches legs per-symbol with cross-day FIFO (essential for any
 * overnight position), then runs the deterministic charges + slab
 * income-tax calc from `indianTax.ts`.
 */

import type { BrokerTrade } from '../api/client';
import {
  computeRealisedFifo,
  computeTaxLiability,
  classifyByMeta,
  startOfCurrentFY,
  type FifoFill,
  type FillForCharges,
  type OrderForBrokerage,
  type TaxLiability,
} from './indianTax';

export function brokerTradesToTaxInputs(trades: BrokerTrade[]): {
  fills: FillForCharges[];
  brokerageOrders: OrderForBrokerage[];
} {
  const fills: FillForCharges[] = [];
  // Brokerage is per-order, not per-fill — group by order_id and bill
  // ₹20 per unique order so partial fills don't inflate it.
  const orderSegments = new Map<string, OrderForBrokerage['segment']>();
  for (const t of trades) {
    const segment = classifyByMeta({
      tradingsymbol: t.tradingsymbol,
      exchange: t.exchange,
      product: t.product,
    });
    fills.push({
      segment,
      side: t.transactionType,
      turnover: (t.quantity * t.averagePricePaise) / 100,
    });
    if (!orderSegments.has(t.orderId)) orderSegments.set(t.orderId, segment);
  }
  const brokerageOrders: OrderForBrokerage[] = [...orderSegments.values()].map(
    (segment) => ({ segment }),
  );
  return { fills, brokerageOrders };
}

export interface YtdSummary {
  /** YYYY-MM-DD start of the current Indian FY. */
  fyStart: string;
  /** Distinct trading days included in the YTD window. */
  dayCount: number;
  /** Cross-day FIFO realised P&L since fyStart, in rupees. */
  realised: number;
  tax: TaxLiability;
}

export function computeYtdSummary(trades: BrokerTrade[], slab: number): YtdSummary {
  const fyStart = startOfCurrentFY();
  const ytdTrades = trades.filter((t) => t.tradeDate >= fyStart);
  const fills: FifoFill[] = ytdTrades.map((t) => ({
    tradingsymbol: t.tradingsymbol,
    exchange: t.exchange,
    transactionType: t.transactionType,
    quantity: t.quantity,
    pricePerUnitRupees: t.averagePricePaise / 100,
    sortKey:
      t.fillTimestamp ?? t.exchangeTimestamp ?? t.orderTimestamp ?? t.tradeDate,
  }));
  const realised = computeRealisedFifo(fills);
  const taxInputs = brokerTradesToTaxInputs(ytdTrades);
  const tax = computeTaxLiability(
    taxInputs.fills,
    taxInputs.brokerageOrders,
    realised,
    slab,
  );
  const dayCount = new Set(ytdTrades.map((t) => t.tradeDate)).size;
  return { fyStart, dayCount, realised, tax };
}
