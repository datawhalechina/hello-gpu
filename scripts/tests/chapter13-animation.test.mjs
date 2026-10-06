import assert from 'node:assert/strict'
import test from 'node:test'
import {MATH,COMMIT_MS,mathState,tileState,rowTile,rmsnorm,MULTI_X,MULTI_W,SHARED_ROUNDS,SERIAL_SUMS} from '../../docs/part2-kernels/chapter13/rmsnorm-model.ts'
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`)
test('RMSNorm uses squares, effective columns and per-column weights',()=>{
 assert.deepEqual(MATH.squares,[9,16,9,16]);assert.equal(MATH.sum,50);assert.equal(MATH.mean,12.5)
 near(MATH.scale,1/Math.sqrt(12.5+1e-5))
 MATH.output.forEach((v,i)=>near(v,[3,2,-6,-4][i]/Math.sqrt(12.5+1e-5)))
 for(let step=1;step<=5;step++){
  const key=['','squares','sum','mean','scale','output'][step]
  assert.equal(mathState(step,COMMIT_MS-1)[key],null)
  assert.notEqual(mathState(step,COMMIT_MS)[key],null)
 }
})
test('serial and half-distance LDS reach same sum without erasing inactive cells',()=>{
 assert.deepEqual(SERIAL_SUMS,[0,9,25,34,50])
 assert.deepEqual(SHARED_ROUNDS,[[9,16,9,16],[18,32,9,16],[50,32,9,16]])
 assert.equal(SERIAL_SUMS.at(-1),SHARED_ROUNDS.at(-1)[0])
})
test('row tiles mask padding and do not combine independent rows',()=>{
 const rows=[...rowTile(0),...rowTile(1)]
 assert.deepEqual(rows.map(r=>r.mask),[[true,true,true,false],[true,true,true,false],[true,true,true,false],[false,false,false,false]])
 assert.deepEqual(rows.map(r=>r.stats?.sum??null),[25,9,0,null])
 rows.filter(r=>r.valid).forEach(r=>{
  assert.deepEqual(r.stats,rmsnorm(MULTI_X[r.row],MULTI_W));near(r.stats.mean,r.stats.sum/3)
 })
 assert.ok(Number.isFinite(rows[2].stats.scale));assert.deepEqual(rows[2].stats.output,[0,0,0]);assert.equal(rows[3].stats,null)
})
test('reverse seeking and reduced motion retain the same stable meaning',()=>{
 for(const model of [mathState,tileState])for(const step of [4,1,3,0,2])assert.deepEqual(model(step,0,true),model(step,COMMIT_MS))
 assert.equal(tileState(3,COMMIT_MS-1).showOutput,false);assert.equal(tileState(3,COMMIT_MS).showOutput,true)
 assert.equal(tileState(4,COMMIT_MS).rows[1].valid,false)
})
