import source from '../../config/modis_viirs_coefficients.csv?raw'
import type { Pass } from './data'
import coefficients from '../../config/coefficients.json'

const columns = [
  'k_combined','k_day','k_night','k_frp_combined','k_frp_day','k_frp_night',
  'k_frp_daily_matched_day','k_frp_daily_night',
] as const
type Column = typeof columns[number]
type ByPass = Record<Pass,number>

function loadCoefficients(csv:string) {
  const [header,record,...extra] = csv.trim().split(/\r?\n/).map(line=>line.split(',').map(value=>value.trim()))
  if (!header || !record || extra.length || header.length!==columns.length ||
    new Set(header).size!==columns.length || columns.some(column=>!header.includes(column))) {
    throw new Error('Expected one MODIS/VIIRS coefficient row with the required headers.')
  }
  const values=record
  if (values.length!==header.length || values.some(value=>!value || !Number.isFinite(Number(value)) || Number(value)<=0)) {
    throw new Error('Expected a positive value for every MODIS/VIIRS coefficient.')
  }
  return Object.fromEntries(header.map((name,index)=>[name,Number(values[index])])) as Record<Column,number>
}

const values=loadCoefficients(source)
export const calibration={
  hotspots:{all:values.k_combined,day:values.k_day,night:values.k_night} satisfies ByPass,
  periodFrp:{all:values.k_frp_combined,day:values.k_frp_day,night:values.k_frp_night} satisfies ByPass,
  dailyFrp:{day:values.k_frp_daily_matched_day,night:values.k_frp_daily_night},
}
export const periodFrpMinimumDays=7
export const calibrationAccuracy=coefficients.calibration_models.count_harmonization.empirical_metrics

export const aquaArchiveStart='2002-07-04'

export function historicalCountPlatform(date:string):'terra'|'aqua' {
  return date<aquaArchiveStart?'terra':'aqua'
}

export function harmonizeHistoricalCount(
  date:string,
  records:readonly {platform:string; detection_count:number|null}[],
  pass:Pass,
) {
  const platform=historicalCountPlatform(date)
  const count=records.find(record=>record.platform===platform)?.detection_count??null
  return {platform,value:count===null?null:count*calibration.hotspots[pass]}
}

export function dailyFrp(day:number,night:number) {
  return day*calibration.dailyFrp.day + night*calibration.dailyFrp.night
}

export const researchCalibration=coefficients.research_candidates.e21
