import { format, isObject, noop, objDisplay, objectAttr } from '@vitest/utils'
import type { File, RunMode, Suite, SuiteAPI, SuiteCollector, SuiteFactory, SuiteHooks, Task, TaskCustom, Test, TestAPI, TestFunction, TestOptions } from './types'
import type { VitestRunner } from './types/runner'
import { createChainable } from './utils/chain'
import { collectTask, collectorContext, createTestContext, runWithSuite, withTimeout } from './context'
import { getHooks, setFn, setHooks } from './map'

// apis
export const suite = createSuite()
export const test = createTest(
  function (name: string, fn?: TestFunction, options?: number | TestOptions) {
    getCurrentSuite().test.fn.call(this, name, fn, options)
  },
)

// alias
export const describe = suite
export const it = test

let runner: VitestRunner
let defaultSuite: SuiteCollector

export function getDefaultSuite() {
  return defaultSuite
}

export function getRunner() {
  return runner
}

export function clearCollectorContext(currentRunner: VitestRunner) {
  if (!defaultSuite)
    defaultSuite = currentRunner.config.sequence.shuffle ? suite.shuffle('') : suite('')
  runner = currentRunner
  collectorContext.tasks.length = 0
  defaultSuite.clear()
  collectorContext.currentSuite = defaultSuite
}

export function getCurrentSuite<ExtraContext = {}>() {
  return (collectorContext.currentSuite || defaultSuite) as SuiteCollector<ExtraContext>
}

export function createSuiteHooks() {
  return {
    beforeAll: [],
    afterAll: [],
    beforeEach: [],
    afterEach: [],
  }
}

// implementations
function createSuiteCollector(name: string, factory: SuiteFactory = () => { }, mode: RunMode, concurrent?: boolean, shuffle?: boolean, suiteOptions?: number | TestOptions) {
  const tasks: (Test | TaskCustom | Suite | SuiteCollector)[] = []
  const factoryQueue: (Test | Suite | SuiteCollector)[] = []

  let suite: Suite

  initSuite()

  const test = createTest(function (name: string, fn = noop, options = suiteOptions) {
    const mode = this.only ? 'only' : this.skip ? 'skip' : this.todo ? 'todo' : this.repeats ? 'repeats' : 'run'

    if (typeof options === 'number')
      options = { timeout: options }

    const test: Test = {
      id: '',
      type: 'test',
      name,
      mode,
      suite: undefined!,
      fails: this.fails,
      retry: options?.retry,
      // 5 repetitions by default
      repeats: mode === 'repeats' && !options?.repeats ? 5 : options?.repeats,
    } as Omit<Test, 'context'> as Test

    if (this.concurrent || concurrent)
      test.concurrent = true
    if (shuffle)
      test.shuffle = true

    const context = createTestContext(test, runner)
    // create test context
    Object.defineProperty(test, 'context', {
      value: context,
      enumerable: false,
    })

    setFn(test, withTimeout(
      () => fn(context),
      options?.timeout ?? runner.config.testTimeout,
    ))

    tasks.push(test)
  })

  const custom = function (this: Record<string, boolean>, name = '') {
    const self = this || {}
    const task: TaskCustom = {
      id: '',
      name,
      type: 'custom',
      mode: self.only ? 'only' : self.skip ? 'skip' : self.todo ? 'todo' : self.repeats ? 'repeats' : 'run',
    }
    tasks.push(task)
    return task
  }

  const collector: SuiteCollector = {
    type: 'collector',
    name,
    mode,
    test,
    tasks,
    collect,
    custom,
    clear,
    on: addHook,
  }

  function addHook<T extends keyof SuiteHooks>(name: T, ...fn: SuiteHooks[T]) {
    getHooks(suite)[name].push(...fn as any)
  }

  function initSuite() {
    if (typeof suiteOptions === 'number')
      suiteOptions = { timeout: suiteOptions }

    suite = {
      id: '',
      type: 'suite',
      name,
      mode,
      shuffle,
      tasks: [],
      repeats: mode === 'repeats' && !suiteOptions?.repeats ? 5 : suiteOptions?.repeats,
    }

    setHooks(suite, createSuiteHooks())
  }

  function clear() {
    tasks.length = 0
    factoryQueue.length = 0
    initSuite()
  }

  async function collect(file?: File) {
    factoryQueue.length = 0
    if (factory)
      await runWithSuite(collector, () => factory(test))

    const allChildren: Task[] = []

    for (const i of [...factoryQueue, ...tasks])
      allChildren.push(i.type === 'collector' ? await i.collect(file) : i)

    suite.file = file
    suite.tasks = allChildren

    allChildren.forEach((task) => {
      task.suite = suite
      if (file)
        task.file = file
    })

    return suite
  }

  collectTask(collector)
  return collector
}

function createSuite() {
  function suiteFn(this: Record<string, boolean | undefined>, name: string, factory?: SuiteFactory, options?: number | TestOptions) {
    const mode: RunMode = this.only ? 'only' : this.skip ? 'skip' : this.todo ? 'todo' : this.repeats ? 'repeats' : 'run'
    return createSuiteCollector(name, factory, mode, this.concurrent, this.shuffle, options)
  }

  suiteFn.each = function<T>(this: { withContext: () => SuiteAPI }, cases: ReadonlyArray<T>, ...args: any[]) {
    const suite = this.withContext()

    if (Array.isArray(cases) && args.length)
      cases = formatTemplateString(cases, args)

    return (name: string, fn: (...args: T[]) => void, options?: number | TestOptions) => {
      const arrayOnlyCases = cases.every(Array.isArray)
      cases.forEach((i, idx) => {
        const items = Array.isArray(i) ? i : [i]
        arrayOnlyCases
          ? suite(formatTitle(name, items, idx), () => fn(...items), options)
          : suite(formatTitle(name, items, idx), () => fn(i), options)
      })
    }
  }

  suiteFn.skipIf = (condition: any) => (condition ? suite.skip : suite) as SuiteAPI
  suiteFn.runIf = (condition: any) => (condition ? suite : suite.skip) as SuiteAPI

  return createChainable(
    ['concurrent', 'shuffle', 'skip', 'only', 'todo', 'repeats'],
    suiteFn,
  ) as unknown as SuiteAPI
}

function createTest(fn: (
  (
    this: Record<'concurrent' | 'skip' | 'only' | 'todo' | 'fails' | 'repeats', boolean | undefined>,
    title: string,
    fn?: TestFunction,
    options?: number | TestOptions
  ) => void
)) {
  const testFn = fn as any

  testFn.each = function<T>(this: { withContext: () => TestAPI }, cases: ReadonlyArray<T>, ...args: any[]) {
    const test = this.withContext()

    if (Array.isArray(cases) && args.length)
      cases = formatTemplateString(cases, args)

    return (name: string, fn: (...args: T[]) => void, options?: number | TestOptions) => {
      const arrayOnlyCases = cases.every(Array.isArray)
      cases.forEach((i, idx) => {
        const items = Array.isArray(i) ? i : [i]

        arrayOnlyCases
          ? test(formatTitle(name, items, idx), () => fn(...items), options)
          : test(formatTitle(name, items, idx), () => fn(i), options)
      })
    }
  }

  testFn.skipIf = (condition: any) => (condition ? test.skip : test) as TestAPI
  testFn.runIf = (condition: any) => (condition ? test : test.skip) as TestAPI

  return createChainable(
    ['concurrent', 'skip', 'only', 'todo', 'fails', 'repeats'],
    testFn,
  ) as TestAPI
}

function formatTitle(template: string, items: any[], idx: number) {
  if (template.includes('%#')) {
    // '%#' match index of the test case
    template = template
      .replace(/%%/g, '__vitest_escaped_%__')
      .replace(/%#/g, `${idx}`)
      .replace(/__vitest_escaped_%__/g, '%%')
  }
  const count = template.split('%').length - 1
  let formatted = format(template, ...items.slice(0, count))
  if (isObject(items[0])) {
    formatted = formatted.replace(/\$([$\w_.]+)/g,
      (_, key) => objDisplay(objectAttr(items[0], key)) as unknown as string,
    // https://github.com/chaijs/chai/pull/1490
    )
  }
  return formatted
}

function formatTemplateString(cases: any[], args: any[]): any[] {
  const header = cases.join('').trim().replace(/ /g, '').split('\n').map(i => i.split('|'))[0]
  const res: any[] = []
  for (let i = 0; i < Math.floor((args.length) / header.length); i++) {
    const oneCase: Record<string, any> = {}
    for (let j = 0; j < header.length; j++)
      oneCase[header[j]] = args[i * header.length + j] as any
    res.push(oneCase)
  }
  return res
}
