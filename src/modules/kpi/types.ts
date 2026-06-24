// KPI snapshot — shared types mirroring netlify/functions/kpi-snapshot.js.
// Fields mirror the Expressway "skunkworks" businessDateData feed; numeric
// fields can be null when the feed has no value for that cut.

export type KpiLevel = "total" | "regionParent" | "region" | "district" | "store";

export interface KpiRow {
  level: KpiLevel;

  // Org identity
  storeTenantBaseId: number;
  districtTenantBaseId: number;
  regionTenantBaseId: number;
  regionParentTenantBaseId: number;
  storeName: string;
  districtName: string;
  regionName: string;
  regionParentName: string;
  companyName: string | null;
  tenantType: number;

  // Sales
  netSales: number | null;
  grossSales: number | null;
  subTotal: number | null;
  averageTicketAmount: number | null;
  yoYNetSalesPercentage: number | null;
  yoYAverageTicket: number | null;
  previousYearNetSales: number | null;
  previousYearSubTotal: number | null;
  yoYNetSales: number | null;

  // Traffic
  tickets: number | null;
  ticketCountExcludingZeroSales: number | null;
  yoYTrafficPercentage: number | null;
  previousYearTickets: number | null;
  yoYTickets: number | null;
  totalCounts: number | null;

  // Channel mix
  orderAheadPercentage: number | null;
  orderAheadNetSales: number | null;
  orderAheadNetSalesDenominator: number | null;
  deliveryPercentage: number | null;
  deliveryNetSales: number | null;
  deliveryNetSalesDenominator: number | null;

  // Labor
  laborPercentage: number | null;
  laborPercentageNumerator: number | null;
  laborPercentageDenominator: number | null;
  laborCost: number | null;
  laborHours: number | null;
  splh: number | null;
  regularLaborCost: number | null;
  overTimeLaborCost: number | null;
  regularHours: number | null;
  overTimeHours: number | null;
  aggregatedLaborPercentage: number | null;

  // Speed / quality
  onTimePercentage: number | null;
  onTimePercentageNumerator: number | null;
  onTimePercentageDenominator: number | null;
  onTimeQuantity: number | null;
  averageTicketTime: number | null;
  totalTicketTime: number | null;
  errorCorrectPercentage: number | null;
  errorCorrect: number | null;
  voidPercentage: number | null;
  voidTotal: number | null;
  voidQuantity: number | null;
  voidsOnCashTickets: number | null;

  // Discounts / cash
  discountPercentage: number | null;
  discountPercentageSales: number | null;
  discountPercentageDiscountsTotal: number | null;
  discountQuantity: number | null;
  discountOnCashTickets: number | null;
  discountTotal: number | null;
  refunds: number | null;
  cashOverShort: number | null;
  paidOutDollars: number | null;
  paidOutCount: number | null;

  // Time slicing (often null on the daily roll-up)
  dayPart: string | null;
  timePeriod: string | null;

  // Allow any extra fields the feed adds without breaking the type.
  [key: string]: unknown;
}

export interface KpiSnapshot {
  ok: true;
  fetchedAt: string;
  total: KpiRow | null;
  scope: { matched: number; unmatched: number; unmatchedSample: string[] };
  levels: {
    region: KpiOrgRow[];
    area: KpiOrgRow[];
    district: KpiOrgRow[];
    store: KpiOrgRow[];
  };
}

// A row rolled up onto OUR org hierarchy (region / area / district / store),
// recomputed from store-level numerators & denominators server-side.
export interface KpiOrgRow {
  name: string;
  storeCount: number;
  number?: string;       // store level only
  district?: string | null;
  region?: string | null;
  netSales: number | null;
  grossSales: number | null;
  subTotal: number | null;
  tickets: number | null;
  averageTicketAmount: number | null;
  yoYNetSalesPercentage: number | null;
  yoYTrafficPercentage: number | null;
  laborCost: number | null;
  laborHours: number | null;
  laborPercentage: number | null;
  splh: number | null;
  onTimePercentage: number | null;
  orderAheadPercentage: number | null;
  deliveryPercentage: number | null;
  discountPercentage: number | null;
  discountTotal: number | null;
  voidTotal: number | null;
}
