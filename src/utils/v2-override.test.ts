import { describe, expect, it } from 'vitest'

import { applyV2Override } from './functions.js'

function fakeVacBot(deviceClass: string, isV2 = false) {
  return {
    deviceClass,
    is950type_V2: () => isV2,
  }
}

describe('applyV2Override', () => {
  it('marks the Yeedi M14 Plus as V2, which the stable library reports as V1', () => {
    // Left as V1 it is sent GetCleanState/Clean, which it never answers
    const bot = applyV2Override(fakeVacBot('6801mm'))
    expect(bot.is950type_V2()).toBe(true)
  })

  it('leaves every other device class as the library reported it', () => {
    expect(applyV2Override(fakeVacBot('yna5xi')).is950type_V2()).toBe(false)
    expect(applyV2Override(fakeVacBot('p95mgv', true)).is950type_V2()).toBe(true)
  })

  it('returns the same control object it was given', () => {
    const bot = fakeVacBot('6801mm')
    expect(applyV2Override(bot)).toBe(bot)
  })
})
