import * as chai from 'chai'
import './setup'
import type { Test } from '@vitest/runner'
import type { Tester } from '@vitest/expect'
import { GLOBAL_EXPECT, JEST_MATCHERS_OBJECT, getState, setState } from '@vitest/expect'
import type { MatcherState } from '../../types/chai'
import { getCurrentEnvironment, getFullName, getType } from '../../utils'

export function createExpect(test?: Test) {
  const expect = ((value: any, message?: string): Vi.Assertion => {
    const { assertionCalls } = getState(expect)
    setState({ assertionCalls: assertionCalls + 1 }, expect)
    const assert = chai.expect(value, message) as unknown as Vi.Assertion
    if (test)
      // @ts-expect-error internal
      return assert.withTest(test) as Vi.Assertion
    else
      return assert
  }) as Vi.ExpectStatic
  Object.assign(expect, chai.expect)

  expect.getState = () => getState<MatcherState>(expect)
  expect.setState = state => setState(state as Partial<MatcherState>, expect)

  // @ts-expect-error global is not typed
  const globalState = getState(globalThis[GLOBAL_EXPECT]) || {}

  setState<MatcherState>({
    // this should also add "snapshotState" that is added conditionally
    ...globalState,
    assertionCalls: 0,
    isExpectingAssertions: false,
    isExpectingAssertionsError: null,
    expectedAssertionsNumber: null,
    expectedAssertionsNumberErrorGen: null,
    environment: getCurrentEnvironment(),
    testPath: test ? test.suite.file?.filepath : globalState.testPath,
    currentTestName: test ? getFullName(test) : globalState.currentTestName,
  }, expect)

  // @ts-expect-error untyped
  expect.extend = matchers => chai.expect.extend(expect, matchers)

  function assertions(expected: number) {
    const errorGen = () => new Error(`expected number of assertions to be ${expected}, but got ${expect.getState().assertionCalls}`)
    if (Error.captureStackTrace)
      Error.captureStackTrace(errorGen(), assertions)

    expect.setState({
      expectedAssertionsNumber: expected,
      expectedAssertionsNumberErrorGen: errorGen,
    })
  }

  function hasAssertions() {
    const error = new Error('expected any number of assertion, but got none')
    if (Error.captureStackTrace)
      Error.captureStackTrace(error, hasAssertions)

    expect.setState({
      isExpectingAssertions: true,
      isExpectingAssertionsError: error,
    })
  }

  const addCustomEqualityTesters = (newTesters: Array<Tester>): void => {
    if (!Array.isArray(newTesters)) {
      throw new TypeError(
        `expect.customEqualityTesters: Must be set to an array of Testers. Was given "${getType(
          newTesters,
        )}"`,
      )
    }

    (globalThis as any)[JEST_MATCHERS_OBJECT].customEqualityTesters.push(
      ...newTesters,
    )
  }

  expect.addEqualityTesters = customTesters => addCustomEqualityTesters(customTesters)

  chai.util.addMethod(expect, 'assertions', assertions)
  chai.util.addMethod(expect, 'hasAssertions', hasAssertions)

  return expect
}

const globalExpect = createExpect()

Object.defineProperty(globalThis, GLOBAL_EXPECT, {
  value: globalExpect,
  writable: true,
  configurable: true,
})

export { assert, should } from 'chai'
export { chai, globalExpect as expect }
