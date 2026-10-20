import zlib from 'node:zlib'

import { describe, expect, it, vi } from 'vitest'

import {
  errorCodesToMatter,
  isWorkStateDevice,
  OpError,
  OpState,
  parseErrorCodes,
  parseRooms,
  parseWorkMode,
  parseWorkState,
  requestRooms,
  requestWorkState,
  tapMessages,
  workStateCommands,
  workStateToMatter,
} from './work-state.js'

// Messages captured from a Yeedi M14 Plus
function workState(robot: string, station: string, paused = 0) {
  return {
    paused,
    robotState: { cleanState: { cid: '122', type: 'auto' }, state: robot, trigger: 'app' },
    stationState: { state: station, trigger: 'app' },
  }
}
// The 'Main' map's rooms: Stairs, Kitchen and an unnamed living room
const roomList = {
  batid: 'ompnao',
  infoSize: 167,
  mid: '1129929481',
  msid: '87998598',
  subsets: 'KLUv/SCnxQIAksQNFKApHRjxrUEABLMkydlycQlyVeYEqW3ndoKxmpuZI4VBJMcw74hpmwPzVinrac3NCa6Oz8sIBQwAdEjhgwBwqLUxLXDSYWCgNuBgvnICFl1xQkI5Ag==',
  type: 'ar',
}

function response(data: any) {
  return { body: { code: 0, data, msg: 'ok' }, header: { fwVer: '1.70.0', hwVer: '0.1.1' } }
}

function fakeControl() {
  const handled: any[] = []
  const control = {
    run: vi.fn(),
    ecovacs: {
      handleMessage(topic: string, message: any, type = 'incoming') {
        handled.push([topic, message, type])
      },
    },
  }
  return { control, handled }
}

function matterFor(robot: string, station: string, paused = 0, charging = false) {
  return workStateToMatter(parseWorkState(workState(robot, station, paused))!, charging)
}

describe('isWorkStateDevice', () => {
  it('knows the Yeedi M14 Plus and nothing else', () => {
    expect(isWorkStateDevice('6801mm')).toBe(true)
    expect(isWorkStateDevice('yna5xi')).toBe(false)
    expect(isWorkStateDevice(undefined)).toBe(false)
  })
})

describe('parseWorkState', () => {
  it('reads the robot, station and paused flag', () => {
    expect(parseWorkState(workState('cleaning', 'washing', 1)))
      .toEqual({ robot: 'cleaning', station: 'washing', paused: true })
    // An idle robot has no clean state
    expect(parseWorkState({ paused: 0, robotState: { state: 'idle' }, stationState: { state: 'drying' } }))
      .toEqual({ robot: 'idle', station: 'drying', paused: false })
  })

  it('ignores a payload with no robot state', () => {
    expect(parseWorkState(undefined)).toBeUndefined()
    expect(parseWorkState({ paused: 0 })).toBeUndefined()
  })
})

describe('workStateToMatter', () => {
  it('follows a whole clean, trips back to the station included', () => {
    expect(matterFor('cleaning', 'idle')).toEqual({ operationalState: OpState.Running, runMode: 1 })
    expect(matterFor('cleaning', 'idle', 1)).toEqual({ operationalState: OpState.Paused, runMode: 1 })
    expect(matterFor('cleaning', 'goEmptying')).toEqual({ operationalState: OpState.SeekingCharger, runMode: 1 })
    expect(matterFor('cleaning', 'emptying', 0, true)).toEqual({ operationalState: OpState.EmptyingDustBin, runMode: 1 })
    expect(matterFor('cleaning', 'washing', 0, true)).toEqual({ operationalState: OpState.CleaningMop, runMode: 1 })
  })

  it('shows a clean waiting at the station mid-wash as paused, not washing', () => {
    // Seen with the dirty water tank full
    expect(matterFor('cleaning', 'washing', 1, true)).toEqual({ operationalState: OpState.Paused, runMode: 1 })
  })

  it('follows the robot home after a clean has ended', () => {
    expect(matterFor('idle', 'goCharging')).toEqual({ operationalState: OpState.SeekingCharger, runMode: 0 })
    expect(matterFor('idle', 'emptying', 0, true)).toEqual({ operationalState: OpState.EmptyingDustBin, runMode: 0 })
    expect(matterFor('idle', 'drying', 0, true)).toEqual({ operationalState: OpState.Charging, runMode: 0 })
    expect(matterFor('idle', 'idle', 0, true)).toEqual({ operationalState: OpState.Charging, runMode: 0 })
  })

  it('shows a robot stopped away from the station as stopped', () => {
    expect(matterFor('idle', 'idle', 0, false)).toEqual({ operationalState: OpState.Stopped, runMode: 0 })
  })

  it('does not guess at robot states never seen on a real robot', () => {
    expect(workStateToMatter({ robot: 'relocating', station: 'idle', paused: false }, false)).toBeUndefined()
  })
})

describe('robot errors', () => {
  it('reads active codes and an empty list once cleared', () => {
    expect(parseErrorCodes({ code: [323] })).toEqual([323])
    expect(parseErrorCodes({ code: [] })).toEqual([])
    expect(parseErrorCodes({})).toBeUndefined()
  })

  it('reports the water tank errors as their Matter equivalents', () => {
    expect(errorCodesToMatter([322])).toBe(OpError.WaterTankEmpty)
    expect(errorCodesToMatter([323])).toBe(OpError.DirtyWaterTankFull)
  })

  it('reports any other code as a general fault, and none as no error', () => {
    expect(errorCodesToMatter([999])).toBe(OpError.UnableToCompleteOperation)
    expect(errorCodesToMatter([])).toBe(OpError.NoError)
  })
})

describe('parseWorkMode', () => {
  it('reads the four work modes and nothing else', () => {
    expect(parseWorkMode({ mode: 0 })).toBe(0)
    expect(parseWorkMode({ mode: 3 })).toBe(3)
    expect(parseWorkMode({ mode: 7 })).toBeUndefined()
    expect(parseWorkMode(undefined)).toBeUndefined()
  })
})

describe('parseRooms', () => {
  it.skipIf(typeof zlib.zstdDecompressSync !== 'function')('decodes the compressed room list, naming rooms by type when unnamed', () => {
    expect(parseRooms(roomList)).toEqual([
      { areaId: 0, name: 'Area 0' },
      { areaId: 2, name: 'Kitchen' },
      { areaId: 3, name: 'Living Room' },
    ])
  })

  it('uses a room\'s own name', () => {
    const named = { ...roomList, subsets: [['0', 'Stairs', '0', '3', '0']] }
    expect(parseRooms(named)).toEqual([{ areaId: 0, name: 'Stairs' }])
  })

  it('ignores map messages that are not room lists, and undecodable ones', () => {
    expect(parseRooms({ ...roomList, type: 'vw' })).toBeUndefined()
    expect(parseRooms({ ...roomList, subsets: 'bm90IHpzdGQ=' })).toBeUndefined()
  })
})

describe('tapMessages', () => {
  it('passes answers and pushes to their handlers, and still on to the library', () => {
    const { control, handled } = fakeControl()
    const states: any[] = []
    const errors: any[] = []
    expect(tapMessages(control, { WorkState: d => states.push(d), Error: d => errors.push(d) })).toBe(true)

    // Responses arrive with the command name as the topic, as an object
    control.ecovacs.handleMessage('getWorkState', response(workState('cleaning', 'idle')), 'response')
    // Pushes arrive with a full topic and a JSON string
    control.ecovacs.handleMessage('iot/atr/onError/9bf7708c/6801mm/T8yN9WUY/j', JSON.stringify(response({ code: [] })))

    expect(states).toEqual([workState('cleaning', 'idle')])
    expect(errors).toEqual([{ code: [] }])
    expect(handled).toHaveLength(2)
  })

  it('leaves other messages alone, and survives a malformed one', () => {
    const { control, handled } = fakeControl()
    const seen: any[] = []
    tapMessages(control, { WorkState: d => seen.push(d) })

    control.ecovacs.handleMessage('getCleanInfo_V2', response({ state: 'idle' }), 'response')
    control.ecovacs.handleMessage('iot/atr/onWorkStateX/x/6801mm/y/j', JSON.stringify(response({})))
    control.ecovacs.handleMessage('iot/atr/onWorkState/x/6801mm/y/j', '{not json')
    expect(seen).toEqual([])
    expect(handled).toHaveLength(3)
  })

  it('declines a control object with no MQTT client', () => {
    expect(tapMessages({}, {})).toBe(false)
  })
})

describe('commands', () => {
  it('asks for state, errors and rooms with Generic commands', () => {
    const { control } = fakeControl()
    requestWorkState(control)
    requestRooms(control, '1129929481')
    expect(control.run.mock.calls).toEqual([
      ['Generic', 'getWorkState', {}],
      ['Generic', 'getError', {}],
      ['Generic', 'getMapSet_V2', { mid: '1129929481', type: 'ar' }],
    ])
  })

  it('cleans rooms with the freeClean payload the robot accepts', () => {
    expect(workStateCommands.cleanRooms([2, 3])).toEqual(['clean_V2', {
      act: 'start',
      content: { count: 1, donotClean: '', type: 'freeClean', value: '1,2;1,3;' },
      mode: '',
      router: 'plan',
    }])
  })
})
