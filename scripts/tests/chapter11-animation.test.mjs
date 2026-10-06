import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import {
  A, B, FINAL, ARRIVAL_MS, dotState, ldsState, reuseSelection,
  groupMapping, edgeState,
} from '../../docs/part2-kernels/chapter11/visuals/matmulModel.mjs'

const done = ARRIVAL_MS

test('点积只跟踪 C00，0→1→5→5，写回是独立的一步', () => {
  assert.deepEqual([0,1,2,3,4].map(step=>dotState(step,done).accumulator), [0,1,5,5,5])
  for (const step of [0,1,2,3]) assert.equal(dotState(step,done).output,null)
  assert.equal(dotState(4,done-1).output,null)
  assert.equal(dotState(4,done).output,5)
  assert.equal(dotState(3,done).product,0)
})

test('乘积到达前不提前改变部分和；输入始终存在', () => {
  assert.equal(dotState(1,done-1).accumulator,0)
  assert.equal(dotState(2,done-1).accumulator,1)
  assert.equal(dotState(3,done-1).accumulator,5)
  assert.deepEqual(A,[[1,2,3],[4,5,6]])
  assert.deepEqual(B,[[1,0],[2,1],[0,2]])
})

test('LDS 与数学图用相同矩阵，每次 inner 都是可独立验证的状态', () => {
  const expected = [0,0,0,2,2,2,8,8,8,8]
  assert.deepEqual(expected.map((_,step)=>ldsState(step,done).accumulator[0][1]),expected)
  assert.deepEqual(ldsState(2,done).accumulator,[[1,0],[4,0]])
  assert.deepEqual(ldsState(3,done).accumulator,[[5,2],[14,5]])
  assert.deepEqual(ldsState(6,done).accumulator,FINAL)
  assert.deepEqual(ldsState(7,done).accumulator,FINAL)
  assert.deepEqual([2,3,6,7].map(step=>{
    const s=ldsState(step,done);return [s.previous,s.left,s.right,s.product]
  }),[[0,1,0,0],[0,2,1,2],[2,3,2,6],[8,0,0,0]])
})

test('装载完成与读完同步分别保护消费和覆盖，尾轮照常同步', () => {
  for (const step of [1,5]) {
    assert.equal(ldsState(step,done-1).loaded,false)
    assert.equal(ldsState(step,done-1).writeBarrierComplete,false)
    assert.equal(ldsState(step,done).writeBarrierComplete,true)
  }
  assert.deepEqual(ldsState(5,done-1).sharedA.map(row=>row.map(c=>c.value)),[[1,2],[4,5]])
  assert.deepEqual(ldsState(5,done-1).sharedB.map(row=>row.map(c=>c.value)),[[1,0],[2,1]])
  assert.deepEqual(ldsState(5,done).sharedA.map(row=>row.map(c=>c.value)),[[3,0],[6,0]])
  for (const step of [4,8]) {
    assert.equal(ldsState(step,done-1).canOverwrite,false)
    assert.equal(ldsState(step,done).canOverwrite,true)
  }
  for (const step of [2,3,6,7]) assert.equal(ldsState(step,done).canOverwrite,false)
  assert.equal(ldsState(3,done-1).accumulator[0][1],0)
  assert.equal(ldsState(6,done-1).accumulator[0][1],2)
  for (let step=0;step<9;step++) assert.equal(ldsState(step,done).output,null)
  assert.equal(ldsState(9,done-1).output,null)
  assert.deepEqual(ldsState(9,done).output,FINAL)
})

test('K 尾部的补零与有效输入零不能混淆', () => {
  const first=ldsState(1,done),tail=ldsState(5,done)
  assert.deepEqual([first.inputsB[0][1].value,first.inputsB[0][1].valid],[0,true])
  assert.deepEqual(tail.inputsA.map(row=>row.map(c=>c.value)),[[3,0],[6,0]])
  assert.deepEqual(tail.inputsB.map(row=>row.map(c=>c.value)),[[0,2],[0,0]])
  assert.deepEqual(tail.inputsA.map(row=>row.map(c=>c.valid)),[[true,false],[true,false]])
  assert.deepEqual(tail.inputsB.map(row=>row.map(c=>c.valid)),[[true,true],[false,false]])
})

test('点选同一个 A 值影响两列，同一个 B 值影响两行', () => {
  const a=reuseSelection('a',0,1)
  assert.deepEqual(a.contributions.map(c=>[c.row,c.column,c.amount]),[[0,0,4],[0,1,2]])
  const b=reuseSelection('b',1,0)
  assert.deepEqual(b.contributions.map(c=>[c.row,c.column,c.amount]),[[0,0,4],[1,0,10]])
  const zero=reuseSelection('b',0,1)
  assert.deepEqual(zero.contributions.map(c=>c.amount),[0,0])
  assert.throws(()=>reuseSelection('a',2,0),RangeError)
})

test('两种 program 映射都覆盖网格一次，id1 坐标不同而不模拟调度', () => {
  for (const group of [1,8]) {
    const mapped=Array.from({length:12},(_,id)=>groupMapping(id,group))
    assert.equal(new Set(mapped.map(c=>`${c.row},${c.column}`)).size,12)
    assert.ok(mapped.every(c=>c.row>=0&&c.row<3&&c.column>=0&&c.column<4))
  }
  assert.deepEqual(groupMapping(1,1),{id:1,row:0,column:1,actualGroup:1})
  assert.deepEqual(groupMapping(1,8),{id:1,row:1,column:0,actualGroup:3})
  assert.throws(()=>groupMapping(12,8),RangeError)
})

test('Triton A/B 的有效区域分别依赖 M/K 与 K/N', () => {
  const first=edgeState(1,done),tail=edgeState(3,done)
  assert.deepEqual(first.tileA.map(row=>row.map(c=>c.valid)),[[true,true],[false,false]])
  assert.deepEqual(first.tileB.map(row=>row.map(c=>c.valid)),[[true,false],[true,false]])
  assert.deepEqual([first.tileA[0][1].value,first.tileA[0][1].valid],[0,true])
  assert.deepEqual(tail.tileA.map(row=>row.map(c=>c.valid)),[[true,false],[false,false]])
  assert.deepEqual(tail.tileB.map(row=>row.map(c=>c.valid)),[[true,false],[false,false]])
  assert.equal(tail.tileA[0][1].reason,'K')
  assert.equal(tail.tileA[1][0].reason,'M')
  assert.equal(tail.tileB[0][1].reason,'N')
  assert.equal(tail.tileB[1][0].reason,'K')
})

test('边缘 tile 临时值 0→2→3，store 只准写 C22', () => {
  assert.equal(edgeState(2,done-1).accumulator,0)
  assert.equal(edgeState(2,done).accumulator,2)
  assert.equal(edgeState(4,done-1).accumulator,2)
  assert.equal(edgeState(4,done).accumulator,3)
  for (let step=0;step<5;step++) assert.equal(edgeState(step,done).output,null)
  assert.equal(edgeState(5,done-1).output,null)
  const final=edgeState(5,done)
  assert.equal(final.output,3)
  assert.deepEqual(final.outputCells.filter(c=>c.valid).map(c=>[c.row,c.column,c.value]),[[2,2,3]])
})

test('反向擦洗和多个实例没有历史残留，reduced motion 直接显示本步完成状态', () => {
  for (const [getState,last] of [[dotState,4],[ldsState,9],[edgeState,5]]) {
    const initial=getState(0,done)
    for (const step of [last,2,last,0,1,last,0]) {
      assert.deepEqual(getState(step,0,true),getState(step,done,false))
      if (step===0) assert.deepEqual(getState(step,done),initial)
    }
  }
  const changed=ldsState(9,done);changed.output[0][0]=999
  assert.equal(ldsState(9,done).output[0][0],5)
})

test('本章八个 Vue 组件可编译，渲染与纯状态模型分离', () => {
  const base=new URL('../../docs/part2-kernels/chapter11/',import.meta.url)
  const files=['matmul-journey.vue','matmul-execution.vue','visuals/MatrixGrid.vue','visuals/ReusePicker.vue',
    ...['DotProductScene','TiledLdsScene','GroupOrderScene','TritonEdgeScene'].map(s=>`visuals/scenes/${s}.vue`)]
  for (const file of files) {
    const source=readFileSync(new URL(file,base),'utf8')
    const {descriptor,errors}=parse(source,{filename:file})
    assert.deepEqual(errors,[],file)
    const script=compileScript(descriptor,{id:file})
    const template=compileTemplate({source:descriptor.template.content,filename:file,id:file,compilerOptions:{bindingMetadata:script.bindings}})
    assert.deepEqual(template.errors,[],file)
  }
})
