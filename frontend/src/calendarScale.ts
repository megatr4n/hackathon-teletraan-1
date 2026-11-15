// Resolve more detail among lower and typical values, and group the long upper tail.
const percentiles=[.10,.20,.30,.40,.50,.75,.97]

export const activityColors=['#593626','#78462d','#995438','#ba6840','#d9814b','#ed9e5b','#f6ba75','#ffdfa7']
export const noActivityColor='#293845'
export const missingActivityColor='#1b2630'

export function calendarActivityScale(raw:(number|null)[],harmonized:(number|null)[]) {
  const positives=[...raw,...harmonized]
    .filter((value):value is number=>value!==null&&value>0&&Number.isFinite(value))
    .sort((a,b)=>a-b)
  if(!positives.length)return undefined

  const lowerBounds=[0,...percentiles.map(p=>positives[Math.ceil(p*positives.length)-1])]
  const maximum=positives[positives.length-1]

  return {
    lowerBounds,
    heat(value:number|null) {
      if(value===null||value<=0||!Number.isFinite(value))return 0
      if(value>=maximum)return 1
      // Ties enter the same band, even when several percentile breaks coincide.
      const next=lowerBounds.findIndex(bound=>value<bound)
      const band=next<0?lowerBounds.length-1:next-1
      const lower=lowerBounds[band]
      const upper=lowerBounds[band+1]??maximum
      return (band+(value-lower)/(upper-lower))/lowerBounds.length
    },
  }
}
