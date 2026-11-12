/**
 * 1-14 读者补全的 Python Agent（A-02）：模板、三个空和参考答案。
 *
 * 模板的写法和代码沙盒一样（kit/sandbox/template.ts）：[[名字: 初始内容]] 标出空。
 * 这是一个 ReAct 循环：每一轮先行动（跑一次、计时、看访存，工具给回来的字典就是观察），
 * 再思考下一轮怎么改，没有能改的就交卷。三个空都在「思考」里，用的是前面关卡学过的东西：
 * - extra：从观察里看出多搬了：搬的车数比理想车数多（1-8）；
 * - stride：多搬了，步长改成多少：相邻线程拿相邻的数（1-8）；
 * - block：block 什么时候不合适：wave 是 32 个 lane，block 不是 32 的倍数时最后一个 wave 有 lane 空着（1-5）。
 *
 * - 初始内容「能跑但不好」（03 第 1 节第 3 条）：原样运行，Agent 第一轮就交卷，只拿 ★1。
 * - 三个空都补对：从任何一个起点出发都拿三星，走的每一步都和规则 Agent（rules.ts）一样；
 *   只补对两个拿不到三星。单测逐项核对（scripts/tests/course-pyagent.test.mjs）。
 * - Agent 能用的名字由 pyodide.ts 的 Python 外壳提供：START（起点，写成 (block, stride)）、think(想法)，
 *   工具 run_kernel、measure、inspect_memory、finish（参数 block、stride，给回观察的字典）。
 *
 * 纯数据，AgentCode 直接导入，服务端渲染时就能画出代码。
 */

export interface StarterBlank {
  /** 读屏和手机上的名字 */
  label: string
  /** 手机上的选项（第一个是初始内容） */
  choices: readonly string[]
}

export interface AgentStarter {
  /** 文件名栏里的名字 */
  file: string
  /** 模板：[[名字: 初始内容]] 标出空 */
  code: string
  blanks: Readonly<Record<string, StarterBlank>>
  /** 参考答案：三个空都这样填，Agent 拿三星 */
  answers: Readonly<Record<string, string>>
}

const VECTOR_ADD_AGENT = `# 你的第一个 Agent：每一轮先行动、看观察，再想下一轮怎么改
block, stride = START
think(f"起点是 block {block}、步长 {stride}。跑一次、计时、看访存。")
while True:
    run_kernel(block=block, stride=stride)               # 行动：跑一次，观察里写着算对没有
    timing = measure(block=block, stride=stride)         # 行动：计时
    memory = inspect_memory(block=block, stride=stride)  # 行动：看访存
    if [[extra: False]] and stride > 1:  # 思考：多搬了吗？
        think("搬的车比理想多：相邻线程拿的数隔得太远，改步长。")
        stride = [[stride: stride]]
    elif [[block: False]]:  # 思考：block 不合适吗？
        think(f"block {block} 不是 32 的倍数：每组最后一个 wave 有 lane 空着。")
        block = (block + 31) // 32 * 32  # 往上取到 32 的倍数
    else:
        think(f"{timing['cycles']} 个周期（模拟），没有能改的地方了。交卷。")
        break
finish(block=block, stride=stride)`

/** 向量加法（tasks.ts 的 vector-add）：调 block 和访问步长。 */
export const VECTOR_ADD_STARTER: AgentStarter = {
  file: 'agent',
  code: VECTOR_ADD_AGENT,
  blanks: {
    extra: {
      label: '第 1 个空：多搬了吗',
      choices: ['False', 'memory["transactions"] > memory["ideal"]', 'memory["transactions"] < memory["ideal"]'],
    },
    stride: { label: '第 2 个空：新的步长', choices: ['stride', '1', 'stride * 2'] },
    block: { label: '第 3 个空：block 不合适吗', choices: ['False', 'block % 32 != 0', 'block % 32 == 0'] },
  },
  answers: { extra: 'memory["transactions"] > memory["ideal"]', stride: '1', block: 'block % 32 != 0' },
}

/** 按任务 id（tasks.ts 的 TUNE_TASKS）找模板。 */
export const AGENT_STARTERS: Readonly<Record<string, AgentStarter>> = { 'vector-add': VECTOR_ADD_STARTER }

export function agentStarter(taskId: string): AgentStarter | null {
  return Object.hasOwn(AGENT_STARTERS, taskId) ? AGENT_STARTERS[taskId] : null
}
