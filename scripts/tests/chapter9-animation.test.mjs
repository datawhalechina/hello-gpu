import assert from 'node:assert/strict'
import test from 'node:test'
import {TREE, SUM_TREE, adjacentTree, sumTreeState, COMMIT_MS, LONG_INPUT, twoStageState, tritonState, programAssignments, shuffleState} from '../../docs/part2-kernels/chapter9/reduction-model.ts'
test('adjacent tree preserves input order, all branches and exact intermediate sums',()=>{
 assert.deepEqual(SUM_TREE,[[3,1,7,0,4,1,6,2],[4,7,5,8],[11,13],[24]])
 for(let step=1;step<=3;step++){
  const before=sumTreeState(step,COMMIT_MS-1),after=sumTreeState(step,COMMIT_MS)
  assert.ok(before.levels[step].every(v=>v===null))
  assert.deepEqual(after.levels[step],SUM_TREE[step])
  assert.deepEqual(after.levels.slice(0,step),SUM_TREE.slice(0,step))
  for(let i=0;i<SUM_TREE[step].length;i++)assert.equal(SUM_TREE[step][i],SUM_TREE[step-1][2*i]+SUM_TREE[step-1][2*i+1])
 }
 assert.deepEqual(adjacentTree([5]),[[5]])
 assert.throws(()=>adjacentTree([1,2,3]),RangeError)
 assert.equal(sumTreeState(2,COMMIT_MS).output,null)
 assert.equal(sumTreeState(3,COMMIT_MS).output,24)
})
test('local read, block sum, global partial write and final are distinct commits',()=>{
 assert.equal(twoStageState(1,COMMIT_MS-1).selectedLocal,0)
 assert.equal(twoStageState(1,COMMIT_MS).selectedLocal,3)
 assert.equal(twoStageState(2,COMMIT_MS-1).selectedLocal,3)
 assert.equal(twoStageState(2,COMMIT_MS).selectedLocal,6)
 assert.deepEqual(twoStageState(3,COMMIT_MS).locals,[[6,2,14,0],[8,2,12,4]])
 assert.deepEqual(twoStageState(4,COMMIT_MS).sums,[22,26])
 assert.equal(twoStageState(4,COMMIT_MS).partials,null)
 assert.equal(twoStageState(5,COMMIT_MS-1).partials,null)
 assert.deepEqual(twoStageState(5,COMMIT_MS).partials,[22,26])
 assert.equal(twoStageState(5,COMMIT_MS).finalReadable,false)
 assert.equal(twoStageState(6,COMMIT_MS-1).output,null)
 assert.equal(twoStageState(6,COMMIT_MS).output,LONG_INPUT.reduce((a,b)=>a+b))
})
test('Triton tile-stride mapping covers every valid element exactly once',()=>{
 for(const n of [1,3,4,7,8,10,17]){
  const a=programAssignments(n,4,Math.min(2,Math.ceil(n/4)))
  const seen=a.flat(2).filter(x=>x!==null).sort((a,b)=>a-b)
  assert.deepEqual(seen,Array.from({length:n},(_,i)=>i))
 }
 assert.deepEqual(programAssignments(10,4,2),[[[0,1,2,3],[8,9,null,null]],[[4,5,6,7]]])
 assert.deepEqual(tritonState(2,COMMIT_MS).accumulator,[6,2,7,0])
 assert.equal(tritonState(3,COMMIT_MS-1).partials,null)
 assert.deepEqual(tritonState(4,COMMIT_MS).finalInput,[15,13,0,0])
 assert.equal(tritonState(5,COMMIT_MS).output,28)
})
test('shuffle keeps its independent half-distance tree and retains sources until commit',()=>{
 assert.deepEqual(TREE,[[3,1,7,0,4,1,6,2],[7,2,13,2],[20,4],[24]])
 const links=shuffleState(3,COMMIT_MS).links
 assert.equal(links.length,7)
 for(const edge of links){
  assert.equal(edge.source-edge.target,2**(3-edge.level))
  assert.equal(TREE[edge.level][edge.target],TREE[edge.level-1][edge.target]+edge.value)
  assert.equal(edge.value,TREE[edge.level-1][edge.source])
 }
 for(let step=1;step<=3;step++){
  const before=shuffleState(step,COMMIT_MS-1),after=shuffleState(step,COMMIT_MS)
  assert.equal(after.completedLevel,step)
  assert.equal(before.completedLevel,step-1)
  assert.equal(after.offset,2**(3-step))
  assert.deepEqual(before.source,TREE[step-1])
  assert.deepEqual(before.values,TREE[step-1])
  assert.deepEqual(after.values,TREE[step])
 }
})
test('backward jumps recompute clean state; reduced motion shows exact stable state',()=>{
 for(const model of [sumTreeState,twoStageState,tritonState,shuffleState]){
  const initial=model(0,2000)
  for(const step of [3,1,2,0])assert.deepEqual(model(step,0,true),model(step,2000))
  assert.deepEqual(model(0,2000),initial)
 }
})
