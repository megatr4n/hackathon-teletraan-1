// Resolve more detail among lower and typical values, and group the long upper tail.
const countPercentiles=[.10,.20,.30,.40,.50,.75,.97]
// FRP's long upper tail leaves fewer distinct colors near typical readings.
const frpPercentiles=[.10,.30,.40,.45,.50,.55,.97]
const weeklyFrpPercentiles=[.10,.25,.40,.55,.70,.85,.97]

export const activityColors=['#593626','#78462d','#995438','#ba6840','#d9814b','#ed9e5b','#f6ba75','#ffdfa7']
const activityChannels=activityColors.map(color=>[1,3,5].map(index=>parseInt(color.slice(index,index+2),16)))

export function frpActivityColor(heat:number) {
  const position=Math.min(activityColors.length-1,heat*activityColors.length)
  const lower=Math.floor(position)
  const next=activityChannels[lower+1]
  if(!next)return activityColors[lower]
  const blend=position-lower
  const channels=activityChannels[lower].map((value,index)=>Math.round(value+(next[index]-value)*blend))
  return 'rgb('+channels.join(',')+')'
}

export const noActivityColor='#293845'
export const missingActivityColor='#1b2630'

export function calendarActivityScale(raw:(number|null)[],harmonized:(number|null)[],metric:'count'|'frp'='count',weekly=false) {
  const weeklyFrp=weekly&&metric==='frp'
  const percentiles=weeklyFrp?weeklyFrpPercentiles:metric==='frp'?frpPercentiles:countPercentiles
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
      // Ratio interpolation gives wide FRP bands useful resolution near their lower edge.
      const fraction=weeklyFrp&&lower>0?Math.log(value/lower)/Math.log(upper/lower):(value-lower)/(upper-lower)
      return (band+fraction)/lowerBounds.length
    },
  }
}
