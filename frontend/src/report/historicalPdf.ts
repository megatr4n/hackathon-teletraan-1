import { jsPDF } from 'jspdf'
import { calibration } from '../calibration'
import { aquaArchiveStart, bins, countBins, dailyCount, dailySeries, finite, mean, pairedCounts, platformLabels, quantile, reportVersion, sum, validateReport, viirsArchiveStart } from './analysis'
import type { HistoricalReport } from './analysis'

const ink='#142B3E',muted='#536575',rule='#D7DFE5',blue='#166A98',orange='#B45C16',gray='#5C6974'
const platformColors={terra:gray,aqua:orange,snpp:blue}
const fmt=(n:number|null,decimals=2)=>n===null?'N/A':n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:decimals})
const short=(n:number)=>Math.abs(n)>=1e6?(n/1e6).toFixed(1)+'M':Math.abs(n)>=1e3?(n/1e3).toFixed(1)+'k':fmt(n,1)
type Line={label:string;color:string;values:(number|null)[];dash?:number[]}

export function buildHistoricalPdf(report:HistoricalReport,areaLabel:string,font:string,generatedAt=new Date().toISOString()) {
  validateReport(report,report.report_start,report.report_end)
  const pdf=new jsPDF({compress:true})
  pdf.addFileToVFS('NotoSans-Regular.ttf',font)
  pdf.addFont('NotoSans-Regular.ttf','Noto Sans','normal')
  pdf.setFont('Noto Sans','normal')
  pdf.setProperties({title:'TELETRAAN-1 | FIRMS observation report',subject:areaLabel,creator:'TELETRAAN-1 '+reportVersion})
  const text=(s:string,x:number,y:number,size=9,color=ink)=>{pdf.setFontSize(size).setTextColor(color).text(s,x,y)}
  const para=(s:string,y:number,size=9,color=muted)=>{
    pdf.setFontSize(size)
    const lines=pdf.splitTextToSize(s,178) as string[]
    lines.forEach((line,i)=>text(line,16,y+i*size*.46,size,color))
    return y+lines.length*size*.46+3
  }
  let first=true
  const page=(section:string,title:string,subtitle:string)=>{
    if(!first)pdf.addPage();first=false
    pdf.setFillColor(ink).rect(0,0,210,3,'F')
    text('TELETRAAN-1     /     EARTH OBSERVATION LAB',16,14,8,muted)
    text(section.toUpperCase(),16,25,8,blue)
    text(title,16,36,20)
    para(subtitle,44,9)
  }
  const table=(headers:string[],rows:string[][],y:number,widths:number[])=>{
    let x=16
    pdf.setFillColor('#EAF0F4').rect(16,y,178,10,'F')
    headers.forEach((h,i)=>{text(h,x+2,y+6.3,8);x+=widths[i]})
    y+=10
    for(const [index,row] of rows.entries()){
      pdf.setFontSize(8)
      const lines=row.map((s,i)=>pdf.splitTextToSize(s,widths[i]-4) as string[])
      const height=Math.max(8,...lines.map(l=>l.length*3.8+4))
      if(y+height>266)throw new Error('Report table exceeds page bounds')
      if(index%2===0)pdf.setFillColor('#F5F8FA').rect(16,y,178,height,'F')
      x=16
      lines.forEach((l,i)=>{l.forEach((s,j)=>text(s,x+2,y+5+j*3.8,8));x+=widths[i]})
      y+=height
      pdf.setDrawColor(rule).setLineWidth(.15).line(16,y,194,y)
    }
    return y+7
  }
  const chart=(dates:string[],lines:Line[],y:number,height:number,label:string,opts:{signed?:boolean;max?:number;legend?:boolean}={})=>{
    const left=34,right=192,top=y+10,bottom=top+height
    const values=lines.flatMap(s=>s.values).filter(finite)
    const min=opts.signed?Math.min(0,...values):0
    let max=opts.max??Math.max(0,...values)
    if(max===min)max=min+1
    const lower=min<0?min*1.08:min,upper=max>0?max*1.08:max,span=upper-lower
    text(label,16,y+3,8,muted)
    const begin=Date.parse(report.report_start),end=Date.parse(report.report_end)
    const xx=(d:string)=>left+(end===begin?.5:(Date.parse(d)-begin)/(end-begin))*(right-left)
    const yy=(v:number)=>bottom-(v-lower)/span*height
    for(let i=0;i<=4;i++){
      const v=lower+span*i/4,py=yy(v)
      pdf.setDrawColor(rule).setLineWidth(.15).line(left,py,right,py)
      pdf.setFontSize(7).setTextColor(muted).text(short(v),left-3,py+1,{align:'right'})
    }
    if(opts.signed&&min<0){pdf.setDrawColor(gray).line(left,yy(0),right,yy(0))}
    const ticks=end===begin?[.5]:[0,.25,.5,.75,1]
    ticks.forEach(t=>{
      const d=new Date(begin+(end-begin)*t).toISOString().slice(0,10)
      pdf.setFontSize(6.7).setTextColor(muted).text(d,left+t*(right-left),bottom+5,{align:'center'})
    })
    lines.forEach(line=>{
      pdf.setDrawColor(line.color).setFillColor(line.color).setLineWidth(.45).setLineDashPattern(line.dash??[],0)
      let previous:{x:number;y:number}|null=null
      line.values.forEach((value,i)=>{
        if(value===null){previous=null;return}
        const p={x:xx(dates[i]),y:yy(value)}
        if(previous)pdf.line(previous.x,previous.y,p.x,p.y)
        pdf.circle(p.x,p.y,dates.length<70?.55:.3,'F')
        previous=p
      })
    })
    pdf.setLineDashPattern([],0)
    if(!values.length)text('No valid observations in this interval',left+25,top+height/2,10,muted)
    if(opts.legend!==false)lines.forEach((line,i)=>{
      const py=bottom+12+i*5
      pdf.setDrawColor(line.color).setLineWidth(.55).setLineDashPattern(line.dash??[],0).line(34,py-1,43,py-1)
      pdf.setLineDashPattern([],0);text(line.label,46,py,8,line.color)
    })
  }
  page('01 / Scope & provenance','FIRMS observation report','Archived satellite observations, reproducible statistics and a documented Aqua MODIS count adjustment.')
  let y=table(['Selection','Value'],[
    ['Area label',areaLabel||JSON.stringify(report.area)],
    ['Exact selection',JSON.stringify(report.area).length>150?'Custom geometry; coordinates are retained in report evidence JSON.':JSON.stringify(report.area)],
    ['Bounds (west, south, east, north)',report.area_bounds.map(v=>v.toFixed(5)).join(', ')],
    ['Period (UTC, inclusive)',report.report_start+' to '+report.report_end],['Selected day',report.day.date],
    ['Orbital pass',report.pass],['Platforms',report.platforms.map(p=>platformLabels[p]).join(', ')],
    ['Dataset release',report.dataset_release],['Aggregation / spatial policy',report.method_id+' / '+report.spatial_mode],
    ['Quality policy / geometry',report.quality_policy+' / '+report.geometry_version],['Generated (UTC)',generatedAt],
  ],61,[47,131])
  y=para('Dataset manifest SHA-256',y,8,blue)
  y=para(report.dataset_manifest_sha256,y,7.5)
  y=para('Query: '+report.query_id+' | Report method: '+reportVersion,y,8)
  y=para('Reading this report',y+3,12,ink)
  if(report.area.kind==='preset')y=para('Preset statistics cover the full bounding box above. The display name does not restrict them to the named fire incident or its perimeter.',y,8)
  y=para('Raw values come from the verified FIRMS archive. Harmonized Aqua counts are estimates calculated from observed Aqua MODIS records using the configured project coefficient.',y)
  para('Detections count satellite records, not distinct fires or burned area. Missing records do not establish an absence of fire. This report does not estimate fire energy, emissions, damage or a calibrated risk probability.',y)

  page('02 / Counts','Satellite detection counts','Raw MODIS combines Terra and Aqua. The adjusted series uses Aqua MODIS. Each series starts when its archive has records.')
  const counts=dailySeries(report),grouped=countBins(report),rows=grouped.rows
  const countLines:Line[]=[{label:'MODIS raw (Terra + Aqua)',color:gray,values:rows.map(r=>r.raw),dash:[1.5,1]},
    {label:'Aqua MODIS harmonized (derived estimate)',color:orange,values:rows.map(r=>r.adjusted)}]
  if(report.report_end<aquaArchiveStart||!report.platforms.includes('aqua'))countLines.pop()
  if(report.report_end>=viirsArchiveStart&&report.platforms.includes('snpp'))countLines.push({label:'VIIRS S-NPP (observed)',color:blue,values:rows.map(r=>r.viirs)})
  const dates=rows.map(r=>new Date((Date.parse(r.date)+Date.parse(r.end))/2).toISOString().slice(0,10))
  // Keep partially observed launch months on or after their archive boundary.
  if(grouped.monthly)rows.forEach((r,i)=>{
    for(const start of [aquaArchiveStart,viirsArchiveStart])if(dates[i]<start&&r.date<start&&r.end>=start)dates[i]=start
  })
  chart(dates,countLines,65,83,grouped.monthly?'Mean detections per day with records (monthly bins)':'Satellite detections per UTC day')
  y=para('Harmonized Aqua MODIS = raw Aqua MODIS x '+calibration.hotspots[report.pass]+' ('+report.pass+' passes). Raw MODIS sums available Terra and Aqua records across overpasses.',192)
  y=para(grouped.monthly?'Monthly values divide each series by its own number of days with records. Partial first/last months are retained. The availability panel and evidence JSON expose these denominators.':'Daily values are plotted without smoothing. Each gap remains a gap; isolated observed days are marked by points.',y)
  para('Archive starts: Aqua MODIS '+aquaArchiveStart+', S-NPP VIIRS '+viirsArchiveStart+'. Missing Aqua and VIIRS observations create gaps. Sensor resolution, overpass time and record availability affect comparability.',y)

  page('03 / Radiative power','Observed fire radiative power','Raw platform measurements are kept separate. All three panels use the same vertical scale.')
  const monthGroups=bins(report.series,grouped.monthly)
  const frp=report.platforms.map(platform=>({platform,values:monthGroups.map(g=>mean(g.map(d=>d.platforms.find(p=>p.platform===platform)?.frp_sum_mw)))}))
  const maxFrp=Math.max(1,...frp.flatMap(p=>p.values).filter(finite))
  frp.forEach((entry,i)=>chart(dates,[{label:platformLabels[entry.platform],color:platformColors[entry.platform],values:entry.values}],60+i*59,35,
    platformLabels[entry.platform]+' | '+(grouped.monthly?'mean observed daily FRP sum (MW)':'daily FRP sum (MW)'),{max:maxFrp,legend:false}))
  para('FRP is power in megawatts. Sums aggregate sampled pixel readings; they are not instantaneous regional power or time-integrated fire radiative energy. Monthly means exclude days without valid FRP.',246,8)

  page('04 / Observation availability','Data support & completeness','A day with records confirms detections. These percentages describe record availability, not satellite acquisition coverage.')
  text(grouped.monthly?'Monthly fraction of requested days with detection records':'Daily presence of detection records',16,65,9)
  const left=51,plotWidth=142
  report.platforms.forEach((platform,i)=>{
    const py=78+i*19
    text(platformLabels[platform],16,py+6,8)
    monthGroups.forEach((g,j)=>{
      const fraction=g.filter(d=>finite(d.platforms.find(p=>p.platform===platform)?.detection_count)).length/g.length
      pdf.setFillColor(239-fraction*160,244-fraction*120,247-fraction*90).rect(left+j*plotWidth/monthGroups.length,py,plotWidth/monthGroups.length+.01,9,'F')
    })
  })
  text(report.report_start,left,142,7,muted)
  pdf.setFontSize(7).text(report.report_end,193,142,{align:'right'})
  text('Light = no recorded day; dark = records on every requested day in the bin.',16,151,8,muted)
  y=table(['Platform','Requested','Record days','FRP days','Missing FRP'],report.period.map(p=>[
    platformLabels[p.platform],fmt(p.requested_days,0),fmt(p.days_with_records,0),fmt(p.days_with_valid_metric,0),fmt(p.missing_frp_count,0),
  ]),161,[42,30,35,30,41])
  y=para('Missing FRP counts individual detections whose FRP is unavailable. They remain in detection counts. Requested days include dates outside each platform\'s archive range; those dates have no invented observations.',y,8.5)
  para('Cloud cover, orbital sampling and detection limitations can leave gaps. Acquisition coverage is unavailable, so days without detections are not assigned zero fire activity.',y,8.5)

  page('05 / Numerical results','Period & selected-day statistics','All FRP summaries below use raw observations. Quantiles use linear interpolation on valid observed daily sums.')
  y=table(['Period metric',...report.platforms.map(p=>platformLabels[p])],[
    ['Detections (records)',...report.period.map(p=>fmt(p.detection_count,0))],['Valid FRP records',...report.period.map(p=>fmt(p.valid_frp_count,0))],
    ['Missing FRP records',...report.period.map(p=>fmt(p.missing_frp_count,0))],['Sum sampled FRP (MW)*',...report.period.map(p=>fmt(p.frp_sum_mw))],
    ['Mean daily FRP (MW)',...report.period.map(p=>fmt(p.mean_observed_daily_frp_mw))],
    ...([.5,.95] as const).map(q=>['Daily FRP '+(q===.5?'median':'95th percentile'),...report.platforms.map(platform=>fmt(quantile(report.series.map(d=>d.platforms.find(p=>p.platform===platform)?.frp_sum_mw).filter(finite),q)))]),
    ['Peak daily FRP (MW)',...report.period.map(p=>fmt(p.peak_frp?.frp_sum_mw??null))],['Peak day (UTC)',...report.period.map(p=>p.peak_frp?.date??'N/A')],
  ],61,[55,...report.platforms.map(()=>123/report.platforms.length)])
  y=para('*Sum of sampled pixel powers over the period, not energy. Values are rounded only for display; exact values are retained in report evidence JSON.',y,8)
  text('Selected day: '+report.day.date,16,y+4,12)
  y=table(['Platform','Detections','FRP sum (MW)','Valid / missing FRP'],report.day.platforms.map(p=>[
    platformLabels[p.platform],fmt(p.detection_count,0),fmt(p.frp_sum_mw),fmt(p.valid_frp_count,0)+' / '+fmt(p.missing_frp_count,0),
  ]),y+9,[42,35,45,56])
  const selectedCounts=dailyCount(report.day,report.pass)
  para('Selected-day harmonized Aqua MODIS estimate: '+fmt(selectedCounts.adjusted)+'. Fractional counts are expected for a model-derived estimate.',y,8.5)

  page('06 / Sensor comparison','Matched-day count diagnostics','Descriptive agreement with VIIRS on dates where both sensors have records. This is not independent validation against ground truth.')
  const paired=pairedCounts(counts)
  y=para('Matched observed days: '+paired.n+' of '+report.series.length+' requested days. Both estimates are compared with VIIRS on the same dates with Aqua and VIIRS records.',64)
  y=table(['Same matched days','Raw Aqua MODIS','Harmonized Aqua'],[
    ['Mean absolute difference (counts)',fmt(paired.rawAqua.mae),fmt(paired.adjusted.mae)],
    ['Signed mean difference (counts)',fmt(paired.rawAqua.meanDifference),fmt(paired.adjusted.meanDifference)],
    ['WAPE relative to VIIRS (%)',fmt(paired.rawAqua.wape),fmt(paired.adjusted.wape)],['Aggregate relative bias (%)',fmt(paired.rawAqua.bias),fmt(paired.adjusted.bias)],
  ],y+3,[88,45,45])
  y=para('For matched dates: difference = Aqua count - VIIRS. WAPE = 100 x sum(abs(difference)) / sum(VIIRS). Relative bias = 100 x sum(difference) / sum(VIIRS). N/A denotes no matched days or a zero denominator.',y)
  y=para('The coefficient is not fitted or changed by exporting this report. A lower difference for this selection does not prove the coefficient transfers to another territory, year or orbital pass.',y)
  text('Largest observed MODIS FRP days in this period',16,y+6,11)
  const peaks=report.series.map(d=>({date:d.date,value:sum(d.platforms.filter(p=>p.platform!=='snpp').map(p=>p.frp_sum_mw))}))
    .filter((d):d is {date:string;value:number}=>d.value!==null).sort((a,b)=>b.value-a.value||a.date.localeCompare(b.date)).slice(0,5)
  table(['UTC date','Raw Terra + Aqua daily FRP sum (MW)'],peaks.length?peaks.map(d=>[d.date,fmt(d.value)]):[['N/A','No MODIS FRP records']],y+12,[45,133])

  page('07 / Seasonal context','MODIS seasonal anomalies','Z-scores use the backend seasonal method on raw MODIS FRP, conditional on recorded days.')
  const scores=monthGroups.map(g=>mean(g.map(d=>d.z_score)))
  chart(dates,[{label:grouped.monthly?'Mean available daily Z-score per month':'Daily Z-score',color:blue,values:scores}],64,63,'Standard deviations relative to seasonal reference',{signed:true})
  y=table(['Availability','Days'],[
    ['Available Z-score',String(report.series.filter(d=>finite(d.z_score)).length)],
    ...['no_modis_frp','insufficient_reference_years','zero_reference_variance','not_requested'].map(s=>[s.replaceAll('_',' '),String(report.series.filter(d=>d.z_score_status===s).length)]),
  ],155,[140,38])
  y=para('Selected day: Z = '+fmt(report.day.z_score)+'; reference support = '+report.day.z_score_reference_days+' recorded days in '+report.day.z_score_reference_years+' other years.',y,8)
  para('Reference: calendar-day window +/-7 days, excluding the target year, at least 8 reference years; sample standard deviation. Z is neither a fire probability nor an uncertainty interval for harmonization.',y,8)

  const annual=new Map<string,typeof report.series>()
  report.series.forEach(d=>{const yr=d.date.slice(0,4),g=annual.get(yr)??[];g.push(d);annual.set(yr,g)})
  const annualRows=[...annual].map(([year,days])=>{
    const cs=dailySeries({...report,series:days})
    return [year,String(days.length),fmt(sum(cs.map(d=>d.raw)),0),fmt(sum(cs.map(d=>d.adjusted))),fmt(sum(cs.map(d=>d.viirs)),0),
      [cs.filter(d=>d.raw!==null).length,cs.filter(d=>d.aqua!==null).length,cs.filter(d=>d.viirs!==null).length].join(' / ')]
  })
  for(let offset=0;offset<annualRows.length;offset+=18){
    page('Appendix / Annual totals','Detection count ledger','Observed records are summed within the selected part of each year. Harmonized counts are estimates, with no rounding before aggregation.')
    y=table(['Year','Days','MODIS raw','Adjusted Aqua','VIIRS','Days M/A/V'],annualRows.slice(offset,offset+18),63,[18,18,36,42,32,32])
    para('Days M/A/V counts recorded days for combined MODIS, Aqua MODIS, and VIIRS. N/A indicates missing observations. Compare totals in the context of the selected dates and record availability.',y,8.5)
  }

  page('Methods / Reproducibility','Methods, limits & sources','The evidence JSON contains the API payload, exact daily series, coefficients, chart bins and matched-day diagnostics.')
  y=para('1. Input and spatial selection',64,12,ink)
  y=para('Verified canonical Parquet release; exact point inclusion in the query area. Catalog boundaries are simplified. Platform/pass filters apply to every statistic. Query identity and dataset manifest SHA-256 are printed on page 1.',y)
  y=para('2. Count harmonization',y+2,12,ink)
  y=para('K_COUNT: all = '+calibration.hotspots.all+'; day = '+calibration.hotspots.day+'; night = '+calibration.hotspots.night+'. Source: config/modis_viirs_coefficients.csv. The report applies each coefficient to Aqua counts, using the all-pass coefficient on the full daily Aqua count for that filter.',y)
  y=para('3. Missing values and comparability',y+2,12,ink)
  y=para('No zeros are fabricated for missing records; no interpolation, extrapolation or substitution of VIIRS. MODIS totals combine available Terra and Aqua observations. Harmonized counts use Aqua MODIS observations starting on 2002-07-04. VIIRS begins on 2012-01-20. Different sensors may observe the same fire repeatedly.',y)
  y=para('4. Statistical limits',y+2,12,ink)
  y=para('FRP is measured in MW. No FRE, emissions or burned area is inferred. Coefficient uncertainty is not quantified here; no confidence band is invented. Matched-day differences measure agreement for this sample, not global accuracy. No synthetic scenario values or preset accuracy percentages enter this historical report.',y)
  y=para('5. Official source definitions',y+2,12,ink)
  const sources=[['NASA FIRMS: MODIS field definitions','https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_MODIS_Firehotspots.html'],
    ['NASA FIRMS: VIIRS field definitions','https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html']]
  for(const [title,url] of sources){text(title,16,y,8,blue);pdf.link(16,y-3,178,5,{url});y=para(url,y+5,7)}
  const total=pdf.getNumberOfPages()
  for(let i=1;i<=total;i++){
    pdf.setPage(i);pdf.setDrawColor(rule).setLineWidth(.2).line(16,278,194,278)
    text('NASA FIRMS archive | '+report.report_start+' / '+report.report_end,16,283,7,muted)
    pdf.setFontSize(7).setTextColor(muted).text(String(i)+' / '+total,194,283,{align:'right'})
  }
  return pdf
}
