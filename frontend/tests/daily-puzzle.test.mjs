import assert from 'node:assert/strict'
import {createServer} from 'vite'

const vite=await createServer({server:{middlewareMode:true},appType:'custom'})
try{
  const {puzzles,puzzleDays,puzzleFocus,solvePuzzle,publishedPuzzles}=await vite.ssrLoadModule('/src/dailyPuzzle.ts')
  const {observations}=await vite.ssrLoadModule('/src/observations.ts')
  const releases=[
    [366,'2020-04-12',['2020-04-12','2020-04-13','2020-04-14']],
    [365,'2018-10-29',['2018-10-28','2018-10-29']],
    [366,'2020-01-05',['2020-01-05']],
  ]
  for(const [index,puzzle] of puzzles.entries()){
    const days=puzzleDays(puzzle,observations(puzzleFocus(puzzle)).history())
    const answer=solvePuzzle(puzzle.rule,days)
    const [length,date,evidence]=releases[index]
    assert.equal(days.length,length)
    assert.equal(days.some(day=>day.date.endsWith('02-29')),length===366)
    assert.equal(days.at(-1).date,puzzle.year+'-12-31')
    assert.equal(answer?.date,date)
    assert.deepEqual(answer?.evidence.map(day=>day.date),evidence)
  }

  const makeDays=(start,counts)=>counts.map((count,i)=>({
    date:new Date(Date.parse(start)+86_400_000*i).toISOString().slice(0,10),
    count,night:count===null?null:count/2,frp:count,
  }))
  const streak={kind:'streak',threshold:210,length:3}
  const rise={kind:'dayOverDayRise',minimumFrp:4500,minimumRise:1900}
  const share={kind:'maxNightShare',minimumNight:125}

  assert.equal(solvePuzzle(streak,makeDays('2020-04-30',[210,210,210]))?.date,'2020-04-30')
  assert.equal(solvePuzzle(streak,makeDays('2020-12-30',[210,210])),null)
  assert.equal(solvePuzzle(streak,makeDays('2020-04-29',[209,210,null,210])),null)
  assert.equal(solvePuzzle(rise,makeDays('2020-01-01',[2600,4500]))?.date,'2020-01-02')
  assert.equal(solvePuzzle(rise,makeDays('2020-01-01',[4500,4500])),null)
  assert.equal(solvePuzzle(share,makeDays('2020-01-01',[0,250,252]))?.date,'2020-01-02')
  assert.equal(solvePuzzle(share,makeDays('2020-01-01',[0,null,240])),null)

  const utcDay=time=>new Date(time).toISOString().slice(0,10)
  assert.equal(publishedPuzzles(utcDay('2026-11-12T23:59:59Z')).length,1)
  assert.equal(publishedPuzzles(utcDay('2026-11-13T00:00:00Z')).length,2)
  assert.equal(publishedPuzzles('2026-11-17')[0].id,puzzles[2].id)
  console.log('Daily Puzzle rules, fixtures and UTC schedule passed.')
}finally{
  await vite.close()
}

