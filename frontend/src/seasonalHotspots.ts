export type SeasonalDay = { date: string; detections: number | null; outsideRange?: boolean }

const months = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export function rankQuietMonths(days: readonly SeasonalDay[]) {
  const byYearMonth = new Map<string, { calendarDays: number; detections: number; hasRecords: boolean }>()
  for (const { date, detections, outsideRange } of days) {
    if (outsideRange) continue
    const key = date.slice(0, 7)
    const entry = byYearMonth.get(key) ?? { calendarDays: 0, detections: 0, hasRecords: false }
    entry.calendarDays++
    if (detections !== null) {
      entry.detections += detections
      entry.hasRecords = true
    }
    byYearMonth.set(key, entry)
  }

  const samples = months.map(() => ({ sum: 0, years: 0, eligibleYears: 0 }))
  for (const [key, entry] of byYearMonth) {
    const year = Number(key.slice(0, 4))
    const month = Number(key.slice(5))
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (entry.calendarDays !== daysInMonth) continue
    const sample = samples[month - 1]
    sample.eligibleYears++
    if (entry.hasRecords) {
      sample.sum += entry.detections / daysInMonth
      sample.years++
    }
  }

  return samples.flatMap(({ sum, years, eligibleYears }, index) => years > 0
    ? [{ month: months[index], index, rate: sum / years, years, eligibleYears }]
    : []).sort((a, b) => a.rate - b.rate || a.index - b.index)
}
