# KPI feed (Skunkworks snapshot) — full field inventory

Every field available on a `businessDateData` row, transcribed from a raw
snapshot payload (2026-07-11, "Total" rollup row, 271 stores). Store rows
carry the same shape. Reference for anything we build on the feed —
Labor v2 persists only a slice of this (see `_lib/kpiLabor.js`).

Values marked **(null in sample)** were null on the Total row of the
2026-07-11 snapshot — they may still populate at store level or on other
days; verify before depending on one.

## Identity / hierarchy

`storeTenantBaseId`, `districtTenantBaseId`, `regionTenantBaseId`,
`regionParentTenantBaseId`, `parentenantBaseId` *(sic, null in sample)*,
`storeName` ("`<store#> <name>`", "Total" on rollups), `districtName`,
`regionName`, `regionParentName`, `companyName`, `tenantType`

## Sales & traffic

- `netSales`, `grossSales`, `subTotal`, `tax`
- `previousYearNetSales`, `previousYearSubTotal`
- `yoYNetSales` ($ delta), `yoYNetSalesPercentage`, `yoYSubTotal` (null in sample)
- `tickets`, `ticketCountExcludingZeroSales`, `previousYearTickets`,
  `yoYTickets` (delta), `yoYTrafficPercentage`, `totalCounts`
- `averageTicketAmount`, `yoYAverageTicket`, `averageUnitVolume`
- `netSalesForComparisonPercentage`, `previousYearNetSalesForComparisonPercentage`,
  `ticketsForComparisonPercentage` (same-store comparison bases)

## Dayparts (objects keyed Breakfast / Lunch / Afternoon / Dinner / Evening)

`netSalesDayparts`, `previousYearNetSalesDayparts`, `yoyNetSalesDaypartsPercentage`,
`ticketsDayparts`, `previousYearTicketsDayparts`, `yoyTicketsDaypartsPercentage`,
`averageTicketAmountDayparts`, `previousYearAverageTicketAmountDayparts`,
`yoyAverageTicketAmountDaypartsPercentage`, `subTotalDayparts`,
`previousYearSubTotalDayparts`, `netSalesDaypartsForComparisonPercentage`,
`previousYearNetSalesDaypartsForComparisonPercentage`,
`ticketsDaypartsForComparisonPercentage`

## Channels & discounts

- `orderAheadPercentage`, `orderAheadNetSales`, `orderAheadNetSalesDenominator`
- `deliveryPercentage`, `deliveryNetSales`, `deliveryNetSalesDenominator`
- `discountPercentage`, `discountPercentageSales`, `discountPercentageDiscountsTotal`,
  `discountTotal`, `discountQuantity`, `discountOnCashTickets`

## Voids / refunds / error correct / cash

- `voidTotal`, `voidQuantity`, `voidsOnCashTickets`,
  `voidPercentage` + `voidPercentageNumerator/Denominator` (null in sample)
- `refunds`, `refundsTotal`, `refundsQuantity`, `refundsPercentage`
  + `refundsPercentageNumerator/Denominator`, `refundsOnCashTickets`
- `errorCorrect`, `errorCorrectQuantity` (null in sample),
  `errorCorrectPercentage` + numerator/denominator (null in sample)
- `cashOverShort`, `paidOutDollars`, `paidOutCount`,
  `deposit1` (null in sample), `deposit2` (null in sample)

## Labor

- `laborPercentage`, `laborPercentageNumerator`, `laborPercentageDenominator`
- `laborCost`, `regularLaborCost`, `overTimeLaborCost`
- `laborHours`, `regularHours`, `overTimeHours`, `averageLaborHours`
- `splh`, `transactionsPerLaborHour` (null in sample),
  `aggregatedLaborPercentage` / `aggregatedSPLH` /
  `aggregatedTransactionsPerLaborHour` (null in sample)
- `targetLaborPercentage`, `varianceTargetValue`,
  `scheduledLaborHours`, `actualVsScheduledHours`
- `carhopHours`, `carhopTotalHours`, `carhopPercentage` (null in sample)
- `firstClockIn`, `lastClockOut` (null in sample)

## Service / speed

- `onTimePercentage`, `onTimePercentageNumerator`, `onTimePercentageDenominator`,
  `onTimeQuantity`
- `averageTicketTime`, `totalTicketTime`
- `firstTicket`, `lastTicket` (null in sample)

## Food cost / inventory (IX-flavored — in the feed!)

- `primaryCategoryIntelliCost`, `primaryCategoryIntellliCostPercentage` *(feed's own triple-l typo)*
- `secondaryCategoryIntelliCost`, `secondaryCategoryIntelliCostPercentage`
- `totalIntelliCost`, `totalIntellliCostPercentage` *(typo again)*
- `itemEfficiency`, `efficiencyRating` (null in sample), `actualCost` (null in sample)
- `doh`, `excessDollars`
- `primaryCategoryActualCost/IdealCost` + percentages (null in sample),
  `secondaryCategoryActualCost/IdealCost` + percentages (null in sample),
  `totalActualCost`, `totalIdealCost`, `totalActualPercentage`,
  `totalIdealCostPercentage` (null in sample)
- `costStartDate`, `costEndDate`

## Count (drives count_daily today)

`dailyScore`, `completionScore`, `accuracyScore`, `dailyCountDollarVariance`

## Guest feedback (fields exist, null in sample)

`complaints`, `complaintsPer10k`, `likelyToReturnCount`, `likelyToReturnAvg`,
`likelyToReturnPercentage`

If these populate at store level on real days, the ranking module's
complaints AND VOG likely-to-return inputs could come straight from the
feed — check store rows before building the VOG parser assumption in.

## Coverage / meta

`storesCount`, `daysCount`, `availableDays`, `polledStoreDays`,
`pollingPercentage`, `startDate`, `endDate`, `dayPart` (null in sample),
`timePeriod` (null in sample)

## What Hub persists today

- `labor_v2_daily` (via `_lib/kpiLabor.js`): net sales + prev-year, labor
  cost/hours/%/target, OT, scheduled vs actual, splh — daily + WTD + PTD bands.
- `count_daily` (via `_lib/kpiCount.js`): the count scores.
- Everything else in this file is available but **not persisted** — the
  ranking module needs tickets, prev-year tickets, on-time num/den and
  voids added to capture (audit `docs/ranking/PHASE0_AUDIT.md` §1).
