import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from '../../docs/sim/syntax/index.ts'
import { formatError } from '../../docs/sim/syntax/errors.ts'

/** 两种写法的位置必然不同，比较语法树时去掉 loc。 */
const shape = (node) => JSON.parse(JSON.stringify(node, (key, value) => (key === 'loc' ? undefined : value)))

/** 包一个 kernel：HIP 的函数体从第 2 行开始，Python 风格从第 3 行开始。 */
const hipK = (body, params = 'float* a, int n') => `__global__ void k(${params}) {\n${body}\n}\n`
const pyK = (body, params = 'a, n') => `@kernel\ndef k(${params}):\n${body}\n`

function kernelOf(src, lang) {
  const r = parse(src, lang)
  assert.ok(r.ok, r.ok ? '' : `${lang} 解析失败：${formatError(r.error)}\n${src}`)
  return r.kernel
}

/**
 * 两种写法解析出同一棵树（位置除外），返回 HIP 写法的树。唯一的例外（ast.ts 开头）：步长不是字面量的 for，
 * HIP 的 dir 记条件的方向，Python 的 range 没有条件，记 null。
 */
function same(hip, py) {
  const tree = shape(kernelOf(hip, 'hip'))
  const pyView = JSON.parse(JSON.stringify(tree, (key, value) => (value?.kind === 'for' && value.step.kind !== 'num' ? { ...value, dir: null } : value)))
  assert.deepEqual(shape(kernelOf(py, 'python')), pyView)
  return tree
}

function error(src, lang) {
  const r = parse(src, lang)
  assert.equal(r.ok, false, `应当报错：\n${src}`)
  return r.error
}

const int = (value) => ({ kind: 'num', type: 'int', value })
const name = (n) => ({ kind: 'name', name: n })
const index = (array, i) => ({ kind: 'index', array, index: i })

// ── 08 第 3 节表格：每一行两种写法 ─────────────────────────────────────────

test('表格「kernel 定义」：__global__ void 和 @kernel + def 得到同一个 kernel；HIP 的参数类型另外给出', () => {
  const tree = same('__global__ void scale(float* x, float alpha, int n) {\n}\n', '@kernel\ndef scale(x, alpha, n):\n    pass\n')
  assert.deepEqual(tree, { kind: 'kernel', name: 'scale', params: [{ name: 'x' }, { name: 'alpha' }, { name: 'n' }], body: [] })

  const hip = parse('__global__ void scale(const float* __restrict__ x, float alpha, int n) {}', 'hip')
  assert.deepEqual(hip.signature, [
    { name: 'x', array: true, type: 'float' },
    { name: 'alpha', array: false, type: 'float' },
    { name: 'n', array: false, type: 'int' },
  ])
  assert.equal(parse('@kernel\ndef scale(x, alpha, n):\n    pass\n', 'python').signature, null)
})

test('表格「内建变量」：四个内建变量同名；.y、.z 提示后面的关卡再讲', () => {
  const tree = same(
    hipK('    a[0] = blockIdx.x + blockDim.x + threadIdx.x + gridDim.x;'),
    pyK('    a[0] = blockIdx.x + blockDim.x + threadIdx.x + gridDim.x'),
  )
  const names = []
  const walk = (e) => (e.kind === 'builtin' ? names.push(e.name) : e.kind === 'binary' && (walk(e.left), walk(e.right)))
  walk(tree.body[0].value)
  assert.deepEqual(names, ['blockIdx.x', 'blockDim.x', 'threadIdx.x', 'gridDim.x'])

  for (const [lang, src, line] of [
    ['hip', hipK('    int i = threadIdx.y;'), 2],
    ['hip', hipK('    int i = gridDim.z;'), 2],
    ['python', pyK('    i = blockIdx.y'), 3],
    ['python', pyK('    i = blockDim.z'), 3],
  ]) {
    const e = error(src, lang)
    assert.equal(e.kind, 'syntax')
    assert.equal(e.line, line)
    assert.match(e.message, /后面的关卡再讲/)
  }
})

test('表格「变量」：int i = …; / float s = 0; 对应 Python 风格的第一次赋值，类型由初值决定', () => {
  const tree = same(
    hipK('    int i = threadIdx.x;\n    float s = 0;\n    s = s + a[i];\n    a[i] = s;'),
    pyK('    i = threadIdx.x\n    s = 0.0\n    s = s + a[i]\n    a[i] = s'),
  )
  assert.deepEqual(tree.body.map((s) => s.kind), ['let', 'let', 'assign', 'assign'])
  // float s = 0; 的 0 直接变成小数，和 s = 0.0 是同一个节点
  assert.deepEqual(tree.body[1].init, { kind: 'num', type: 'float', value: 0 })

  // HIP 的隐式转换变成显式的 cast，对应 Python 风格自己写的 float(…)、int(…)
  const casts = same(hipK('    float x = n;\n    int k = a[0];\n    k = x;'), pyK('    x = float(n)\n    k = int(a[0])\n    k = int(x)'))
  assert.deepEqual(casts.body[0].init, { kind: 'cast', type: 'float', arg: name('n') })
  assert.deepEqual(casts.body[2].value, { kind: 'cast', type: 'int', arg: name('x') })

  // Python 风格不偷偷转换：第一次赋值是整数，后面就不能存小数
  const e = error(pyK('    s = 0\n    s += 0.5'), 'python')
  assert.deepEqual([e.kind, e.line, e.col], ['type', 4, 5])
  assert.match(e.hint, /s = 0\.0/)
})

test('表格「表达式」：+ - * / %、比较、&& || ! 与 and or not、三元与条件表达式', () => {
  const tree = same(
    hipK('    int i = threadIdx.x;\n    bool ok = i < n && !(i % 2 == 1 || i >= 8);\n    a[i] = ok ? a[i] * 2 - 1 : -a[i] / 2.0;'),
    pyK('    i = threadIdx.x\n    ok = i < n and not (i % 2 == 1 or i >= 8)\n    a[i] = a[i] * 2 - 1 if ok else -a[i] / 2.0'),
  )
  const ok = tree.body[1].init
  assert.equal(ok.op, 'and')
  assert.equal(ok.right.kind, 'unary')
  assert.equal(ok.right.op, 'not')
  assert.equal(ok.right.arg.op, 'or')
  const value = tree.body[2].value
  assert.equal(value.kind, 'cond')
  assert.equal(value.body.op, '-')
  assert.equal(value.orelse.op, '/')
})

test('除法：HIP 两个整数相除记成 //，有小数时是 /；Python 风格的 / 永远是小数，当下标会报错', () => {
  const hip = kernelOf(hipK('    int i = threadIdx.x / 2;\n    float x = a[0] / 2;'), 'hip')
  assert.equal(hip.body[0].init.op, '//')
  assert.equal(hip.body[1].init.op, '/')
  same(hipK('    int i = threadIdx.x / 2;\n    a[i] = a[i] / 2;'), pyK('    i = threadIdx.x // 2\n    a[i] = a[i] / 2'))

  // 报错指向那个 /；除得尽也不行（8 / 1 得到 8.0）；先 / 再 // 结果仍是小数
  for (const [src, col] of [['    a[threadIdx.x / 2] = 0', 19], ['    a[8 / 1] = 0', 9], ['    a[(threadIdx.x / 1) // 1] = 0', 20]]) {
    const e = error(pyK(src), 'python')
    assert.deepEqual([e.kind, e.line, e.col], ['type', 3, col])
    assert.match(e.message, /Python 里 \/ 的结果是小数/)
    assert.match(e.hint, /\/\//)
  }
  // int(…) 转成整数以后可以当下标
  kernelOf(pyK('    a[int(threadIdx.x / 2)] = 0'), 'python')
})

test('表格「控制流」：if / else if / else 对应 if / elif / else', () => {
  const tree = same(
    hipK('    int i = threadIdx.x;\n    if (i < 2) {\n        a[i] = 1;\n    } else if (i < 4) {\n        a[i] = 2;\n    } else {\n        a[i] = 3;\n    }'),
    pyK('    i = threadIdx.x\n    if i < 2:\n        a[i] = 1\n    elif i < 4:\n        a[i] = 2\n    else:\n        a[i] = 3'),
  )
  const first = tree.body[1]
  assert.equal(first.kind, 'if')
  assert.equal(first.orelse.length, 1)
  assert.equal(first.orelse[0].kind, 'if')
  assert.equal(first.orelse[0].orelse[0].value.value, 3)
  // 不加大括号的一句、写在冒号同一行的一句
  same(hipK('    if (threadIdx.x < n) a[0] = 1;\n    else a[0] = 2;'), pyK('    if threadIdx.x < n: a[0] = 1\n    else: a[0] = 2'))
})

test('表格「控制流」：计数 for 对应 range 的一到三个参数，<= 和倒着数也对得上；步长是变量时 HIP 记下条件的方向', () => {
  const loops = [
    ['for (int k = 0; k < n; k++)', 'for k in range(n):', [int(0), name('n'), int(1)], 'up'],
    ['for (int k = 2; k < n; k += 3)', 'for k in range(2, n, 3):', [int(2), name('n'), int(3)], 'up'],
    ['for (int k = 0; k < n; k = k + 4)', 'for k in range(0, n, 4):', [int(0), name('n'), int(4)], 'up'],
    ['for (int k = 1; k <= n; ++k)', 'for k in range(1, n + 1):', [int(1), { kind: 'binary', op: '+', left: name('n'), right: int(1) }, int(1)], 'up'],
    ['for (int k = n - 1; k >= 0; k--)', 'for k in range(n - 1, -1, -1):', [{ kind: 'binary', op: '-', left: name('n'), right: int(1) }, int(-1), int(-1)], 'down'],
    ['for (int k = n; k > 0; k -= 2)', 'for k in range(n, 0, -2):', [name('n'), int(0), int(-2)], 'down'],
  ]
  for (const [h, p, [start, stop, step], dir] of loops) {
    const tree = same(hipK(`    ${h} {\n        a[k] = 0;\n    }`), pyK(`    ${p}\n        a[k] = 0`))
    assert.deepEqual(tree.body[0], { kind: 'for', name: 'k', start, stop, step, dir, body: [{ kind: 'assign', target: index('a', name('k')), value: int(0) }] })
  }
  // 步长是变量：HIP 的条件定了方向（运行时步长的正负和它相反就报错）；Python 的 range 运行时按步长的正负走
  for (const [h, dir] of [['for (int k = 0; k < n; k += s)', 'up'], ['for (int k = n; k >= 0; k -= s)', 'down']]) {
    assert.equal(kernelOf(hipK(`    ${h} {\n        a[k] = 0;\n    }`, 'float* a, int n, int s'), 'hip').body[0].dir, dir)
  }
  assert.equal(kernelOf(pyK('    for k in range(n, -1, s):\n        a[k] = 0', 'a, n, s'), 'python').body[0].dir, null)
})

test('表格「控制流」：while 两种写法相同；循环变量只在循环里有效，循环里不能改它', () => {
  const tree = same(
    hipK('    int v = n;\n    while (v > 1) {\n        v = v / 2;\n    }\n    a[0] = v;'),
    pyK('    v = n\n    while v > 1:\n        v = v // 2\n    a[0] = v'),
  )
  assert.equal(tree.body[1].kind, 'while')

  const e = error(pyK('    for k in range(n):\n        a[k] = 0\n    a[k] = 1'), 'python')
  assert.deepEqual([e.kind, e.line], ['syntax', 5])
  assert.match(e.message, /for 循环里定义的/)
  const changed = error(hipK('    for (int k = 0; k < n; k++) {\n        k = k + 1;\n    }'), 'hip')
  assert.deepEqual([changed.kind, changed.line, changed.col], ['syntax', 3, 9])
  assert.match(changed.message, /循环变量/)
})

test('表格「数组」：a[i] 读写；a[i] += v 展开成读一次、写一次', () => {
  const tree = same(
    hipK('    int i = threadIdx.x;\n    a[i] = a[i + 1] * 2;\n    a[i] += 1;'),
    pyK('    i = threadIdx.x\n    a[i] = a[i + 1] * 2\n    a[i] += 1'),
  )
  assert.deepEqual(tree.body[2], {
    kind: 'assign',
    target: index('a', name('i')),
    value: { kind: 'binary', op: '+', left: index('a', name('i')), right: int(1) },
  })
})

test('表格「共享内存」：__shared__ float s[64]; 对应 s = shared(64)，整数数组写 shared(8, int)', () => {
  const tree = same(hipK('    __shared__ float s[64];\n    __shared__ int c[8];\n    s[0] = c[1];'), pyK('    s = shared(64)\n    c = shared(8, int)\n    s[0] = c[1]'))
  assert.deepEqual(tree.body.slice(0, 2), [
    { kind: 'shared', name: 's', elem: 'float', size: 64 },
    { kind: 'shared', name: 'c', elem: 'int', size: 8 },
  ])
})

test('表格「同步」：__syncthreads(); 对应 syncthreads()', () => {
  const tree = same(hipK('    a[0] = 1;\n    __syncthreads();\n    a[1] = a[0];'), pyK('    a[0] = 1\n    syncthreads()\n    a[1] = a[0]'))
  assert.deepEqual(tree.body[1], { kind: 'sync' })
})

test('表格「原子操作」：atomicAdd(&a[i], v); 对应 atomic_add(a, i, v)', () => {
  const tree = same(hipK('    atomicAdd(&a[n - 1], 2.5f);'), pyK('    atomic_add(a, n - 1, 2.5)'))
  assert.deepEqual(tree.body[0], {
    kind: 'atomic',
    op: 'add',
    array: 'a',
    index: { kind: 'binary', op: '-', left: name('n'), right: int(1) },
    value: { kind: 'num', type: 'float', value: 2.5 },
  })
})

// ── 同一程序的两种写法 ──────────────────────────────────────────────────

const PROGRAMS = [
  [
    '向量加法：全局下标 + 边界检查',
    `__global__ void vector_add(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        c[i] = a[i] + b[i];
    }
}`,
    `@kernel
def vector_add(a, b, c, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        c[i] = a[i] + b[i]`,
  ],
  [
    '缩放：小数参数',
    `__global__ void scale(float* x, float alpha, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) x[i] = alpha * x[i];
}`,
    `@kernel
def scale(x, alpha, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        x[i] = alpha * x[i]`,
  ],
  [
    '逐行求和：计数循环 + 小数累加',
    `__global__ void row_sum(const float* a, float* out, int m) {
    int row = blockIdx.x * blockDim.x + threadIdx.x;
    float s = 0;
    for (int k = 0; k < m; k++) {
        s += a[row * m + k];
    }
    out[row] = s;
}`,
    `@kernel
def row_sum(a, out, m):
    row = blockIdx.x * blockDim.x + threadIdx.x
    s = 0.0
    for k in range(m):
        s += a[row * m + k]
    out[row] = s`,
  ],
  [
    '网格跨步循环',
    `__global__ void grid_stride_add(const float* a, const float* b, float* c, int n) {
    int start = blockIdx.x * blockDim.x + threadIdx.x;
    int stride = blockDim.x * gridDim.x;
    for (int i = start; i < n; i += stride) {
        c[i] = a[i] + b[i];
    }
}`,
    `@kernel
def grid_stride_add(a, b, c, n):
    start = blockIdx.x * blockDim.x + threadIdx.x
    stride = blockDim.x * gridDim.x
    for i in range(start, n, stride):
        c[i] = a[i] + b[i]`,
  ],
  [
    '倒序复制：倒着数的循环',
    `__global__ void reverse_copy(const float* a, float* b, int n) {
    if (threadIdx.x == 0) {
        for (int k = n - 1; k >= 0; k--) {
            b[n - 1 - k] = a[k];
        }
    }
}`,
    `@kernel
def reverse_copy(a, b, n):
    if threadIdx.x == 0:
        for k in range(n - 1, -1, -1):
            b[n - 1 - k] = a[k]`,
  ],
  [
    '折半计数：while + 整数除法',
    `__global__ void halving_steps(int* out, int n) {
    int steps = 0;
    int v = n;
    while (v > 1) {
        v /= 2;
        steps++;
    }
    out[threadIdx.x] = steps;
}`,
    `@kernel
def halving_steps(out, n):
    steps = 0
    v = n
    while v > 1:
        v //= 2
        steps += 1
    out[threadIdx.x] = steps`,
  ],
  [
    '块内反转：共享数组 + 同步',
    `__global__ void reverse_block(const float* a, float* b) {
    __shared__ float tile[64];
    int t = threadIdx.x;
    int i = blockIdx.x * blockDim.x + t;
    tile[t] = a[i];
    __syncthreads();
    b[i] = tile[blockDim.x - 1 - t];
}`,
    `@kernel
def reverse_block(a, b):
    tile = shared(64)
    t = threadIdx.x
    i = blockIdx.x * blockDim.x + t
    tile[t] = a[i]
    syncthreads()
    b[i] = tile[blockDim.x - 1 - t]`,
  ],
  [
    '树状归约',
    `__global__ void block_sum(const float* a, float* out) {
    __shared__ float s[64];
    int t = threadIdx.x;
    s[t] = a[blockIdx.x * blockDim.x + t];
    __syncthreads();
    int stride = blockDim.x / 2;
    while (stride > 0) {
        if (t < stride) {
            s[t] += s[t + stride];
        }
        __syncthreads();
        stride /= 2;
    }
    if (t == 0) {
        out[blockIdx.x] = s[0];
    }
}`,
    `@kernel
def block_sum(a, out):
    s = shared(64)
    t = threadIdx.x
    s[t] = a[blockIdx.x * blockDim.x + t]
    syncthreads()
    stride = blockDim.x // 2
    while stride > 0:
        if t < stride:
            s[t] += s[t + stride]
        syncthreads()
        stride //= 2
    if t == 0:
        out[blockIdx.x] = s[0]`,
  ],
  [
    '原子求和',
    `__global__ void atomic_sum(const float* a, float* total, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        atomicAdd(&total[0], a[i]);
    }
}`,
    `@kernel
def atomic_sum(a, total, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        atomic_add(total, 0, a[i])`,
  ],
  [
    '直方图：整数共享数组、HIP 的隐式转换、原子加',
    `__global__ void histogram(const float* x, int* bins, int n) {
    __shared__ int counts[8];
    int t = threadIdx.x;
    if (t < 8) {
        counts[t] = 0;
    }
    __syncthreads();
    int i = blockIdx.x * blockDim.x + t;
    if (i < n) {
        int b = x[i] * 8;
        atomicAdd(&counts[b], 1);
    }
    __syncthreads();
    if (t < 8) {
        atomicAdd(&bins[t], counts[t]);
    }
}`,
    `@kernel
def histogram(x, bins, n):
    counts = shared(8, int)
    t = threadIdx.x
    if t < 8:
        counts[t] = 0
    syncthreads()
    i = blockIdx.x * blockDim.x + t
    if i < n:
        b = int(x[i] * 8)
        atomic_add(counts, b, 1)
    syncthreads()
    if t < 8:
        atomic_add(bins, t, counts[t])`,
  ],
  [
    '分类：else if 与 elif、负数',
    `__global__ void sign_of(const int* a, int* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        if (a[i] > 0) {
            out[i] = 1;
        } else if (a[i] < 0) {
            out[i] = -1;
        } else {
            out[i] = 0;
        }
    }
}`,
    `@kernel
def sign_of(a, out, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        if a[i] > 0:
            out[i] = 1
        elif a[i] < 0:
            out[i] = -1
        else:
            out[i] = 0`,
  ],
  [
    '奇偶分支：% 与分支发散',
    `__global__ void even_odd(float* a, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        if (threadIdx.x % 2 == 0) {
            a[i] = a[i] * 2;
        } else {
            a[i] = a[i] + 1;
        }
    }
}`,
    `@kernel
def even_odd(a, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        if threadIdx.x % 2 == 0:
            a[i] = a[i] * 2
        else:
            a[i] = a[i] + 1`,
  ],
  [
    '裁剪：逻辑运算与条件表达式',
    `__global__ void clamp(const float* a, float* b, int n, float lo, float hi) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n && !(a[i] < lo || a[i] > hi)) {
        b[i] = a[i];
    } else if (i < n) {
        b[i] = a[i] < lo ? lo : hi;
    }
}`,
    `@kernel
def clamp(a, b, n, lo, hi):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n and not (a[i] < lo or a[i] > hi):
        b[i] = a[i]
    elif i < n:
        b[i] = lo if a[i] < lo else hi`,
  ],
]

test(`同一程序的两种写法得到同一棵语法树（${PROGRAMS.length} 对）`, () => {
  assert.ok(PROGRAMS.length >= 10)
  for (const [title, hip, py] of PROGRAMS) {
    const tree = same(hip, py)
    assert.ok(tree.body.length > 0, title)
  }
})

// ── 四类错误 ─────────────────────────────────────────────────────────────

/** [写法, 代码, 行, 列, message 里应该有的话] */
const ERRORS = {
  syntax: [
    ['hip', hipK('    int i = threadIdx.x\n    a[i] = 0;'), 2, 24, /少了分号/],
    ['hip', hipK('    int i = threadIdx.x；'), 2, 24, /中文标点「；」/],
    ['hip', hipK('    int j = threadIdx.x;\n    if (j < n and j > 0) a[j] = 0;'), 3, 15, /HIP 里不用「and」/],
    ['python', pyK('    i = threadIdx.x\n    if i < n\n        a[i] = 0'), 4, 13, /少了冒号/],
    ['python', pyK('    i = threadIdx.x\n      a[i] = 0'), 4, 7, /多缩进了/],
    ['python', pyK('    if threadIdx.x < 4:\n        t = 1\n    a[0] = t'), 5, 12, /出了 if 语句就不能用了/],
    ['python', pyK('    __syncthreads()'), 3, 5, /syncthreads\(\)/],
  ],
  type: [
    ['python', pyK('    i = threadIdx.x\n    a[i / 2] = 0'), 4, 9, /下标必须是整数/],
    ['hip', hipK('    float x = 1.5;\n    a[x] = 0;'), 3, 7, /下标必须是整数/],
    ['hip', hipK('    int i = threadIdx.x;\n    a[i] = a[i] % 2;'), 3, 17, /% 只能用在两个整数之间/],
    ['python', pyK('    s = shared(64)\n    x = s + 1'), 4, 9, /是数组/],
    ['hip', hipK('    a[0] = 1;', 'const float* a'), 2, 5, /const/],
  ],
  runtime: [
    ['hip', hipK('    int i = threadIdx.x;\n    a[i] = a[i] / 0;'), 3, 19, /除以 0/],
    ['python', pyK('    i = threadIdx.x % 0'), 3, 23, /对 0 取余数/],
    ['python', pyK('    for k in range(0, n, 0):\n        a[k] = 0'), 3, 26, /步长是 0/],
    ['hip', hipK('    for (int k = 0; k < n; k += 0) {\n        a[k] = 0;\n    }'), 2, 33, /步长是 0/],
  ],
  limit: [
    ['hip', hipK('    int i = 3000000000;'), 2, 13, /2147483647/],
    ['python', pyK('    s = shared(4000)\n    t = shared(100)'), 4, 16, /4096/],
    ['hip', hipK(`    int x = ${'('.repeat(40)}1${')'.repeat(40)};`), 2, 44, /嵌套超过了 32 层/],
    ['python', pyK(Array.from({ length: 210 }, (_, i) => `    x${i} = ${i}`).join('\n')), 201, 1, /200 行/],
  ],
}

for (const [kind, samples] of Object.entries(ERRORS)) {
  test(`「${kind}」类错误：每个样例都是中文，指出行和列（${samples.length} 个）`, () => {
    assert.ok(samples.length >= 3)
    for (const [lang, src, line, col, pattern] of samples) {
      const e = error(src, lang)
      assert.deepEqual([e.kind, e.line, e.col], [kind, line, col], `${formatError(e)}\n${src}`)
      assert.match(e.message, pattern)
      assert.match(e.message, /\p{Script=Han}/u)
      assert.match(e.hint, /\p{Script=Han}/u)
    }
  })
}

test('formatError：位置和类别写在最前面，后面是原因和怎么改', () => {
  const e = error(hipK('    int i = threadIdx.x\n    a[i] = 0;'), 'hip')
  assert.equal(formatError(e), `第 2 行第 24 列，语法错误：${e.message}${e.hint}`)
  // HIP 里 // 是注释：漏分号的提示顺带说明
  const comment = error(hipK('    int j = threadIdx.x // 2\n    a[j] = 0;'), 'hip')
  assert.match(comment.hint, /\/\/ 是注释/)
})
