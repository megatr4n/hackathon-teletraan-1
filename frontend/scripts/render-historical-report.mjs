// Render exactly the browser PDF builder from a saved /report-data response.
// Run from frontend: node scripts/render-historical-report.mjs input.json output.pdf 'Area label'
import {readFile,writeFile} from 'node:fs/promises'
import {createServer} from 'vite'
const [input,output,label='Saved FIRMS selection']=process.argv.slice(2)
if(!input||!output)throw new Error('Expected input.json output.pdf [area label]')
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'})
try{
  const {buildHistoricalPdf}=await vite.ssrLoadModule('/src/report/historicalPdf.ts')
  const {reportEvidence}=await vite.ssrLoadModule('/src/report/analysis.ts')
  const report=JSON.parse(await readFile(input,'utf8'))
  const font=(await readFile('src/report/NotoSans-Regular.ttf')).toString('base64')
  const generatedAt=new Date().toISOString()
  const pdf=buildHistoricalPdf(report,label,font,generatedAt)
  await writeFile(output,Buffer.from(pdf.output('arraybuffer')))
  await writeFile(output.replace(/\.pdf$/i,'')+'-evidence.json',JSON.stringify(reportEvidence(report,generatedAt),null,2))
  console.log(JSON.stringify({output,pages:pdf.getNumberOfPages(),days:report.series.length}))
}finally{await vite.close()}
