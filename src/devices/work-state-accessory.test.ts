import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { OpError, OpState } from '../utils/work-state.js'
import { EcovacsRoboticVacuumAccessory } from './EcovacsRoboticVacuumAccessory.js'

// A Matter API that keeps each cluster's state, as the Matter server would
function fakeApi() {
  const state: Record<string, Record<string, unknown>> = {}
  return {
    state,
    matter: {
      uuid: { generate: (s: string) => `uuid-${s}` },
      deviceTypes: { RoboticVacuumCleaner: {} },
      updateAccessoryState: vi.fn(async (_uuid: string, cluster: string, attributes: Record<string, unknown>) => {
        state[cluster] = { ...state[cluster], ...attributes }
      }),
      getAccessoryState: vi.fn(async (_uuid: string, cluster: string) => state[cluster]),
    },
  }
}

const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

// A vacbot control object whose MQTT client can be fed messages from the robot
function fakeControl() {
  const control: any = new EventEmitter()
  control.is_ready = true
  control.run = vi.fn()
  control.ecovacs = { handleMessage: vi.fn() }
  return control
}

function robotSends(control: any, name: string, data: any) {
  control.ecovacs.handleMessage(`iot/atr/on${name}/did/6801mm/res/j`, JSON.stringify({ body: { data } }))
}

function workState(robot: string, station = 'idle', paused = 0) {
  return { paused, robotState: { state: robot }, stationState: { state: station } }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

async function setup() {
  const api = fakeApi()
  const vacuum = new EcovacsRoboticVacuumAccessory(api as any, log, {
    did: '9bf7708c-5016-4ab4-bef8-af00fe433150',
    nick: 'DjEufy',
    company: 'eco-ng',
    model: 'YEEDI M14 PLUS',
    isV2: true,
    usesWorkState: true,
  })
  await vacuum.markRegistered()
  const control = fakeControl()
  vacuum.connectControl(control)
  control.run.mockClear()
  const handlers: any = (vacuum as any).handlers
  return { api, vacuum, control, handlers }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('a work-state robot as a Matter vacuum', () => {
  it('offers its work modes as clean modes, and the station states', () => {
    const vacuum = new EcovacsRoboticVacuumAccessory(fakeApi() as any, log, {
      did: 'd',
      nick: 'n',
      company: 'eco-ng',
      model: 'm',
      usesWorkState: true,
    })
    const clusters: any = (vacuum as any).clusters
    expect(clusters.rvcCleanMode.supportedModes.map((m: any) => m.label))
      .toEqual(['Vacuum & Mop', 'Vacuum', 'Mop', 'Mop after Vacuum'])
    expect(clusters.rvcOperationalState.operationalStateList.map((s: any) => s.operationalStateId))
      .toContain(OpState.CleaningMop)
  })

  it('takes its status from the work state, not the clean report or charge state', async () => {
    const { api, control } = await setup()
    robotSends(control, 'WorkState', workState('cleaning'))
    // Both of these answer 'idle' mid-clean on this robot
    control.emit('CleanReport', 'idle')
    control.emit('ChargeState', 'idle')
    await settle()
    expect(api.state.rvcOperationalState).toMatchObject({ operationalState: OpState.Running })
    expect(api.state.rvcRunMode).toMatchObject({ currentMode: 1 })
  })

  it('shows a robot error with its Matter reason until the robot clears it', async () => {
    const { api, control } = await setup()
    robotSends(control, 'WorkState', workState('cleaning', 'washing', 1))
    robotSends(control, 'Error', { code: [323] })
    await settle()
    expect(api.state.rvcOperationalState).toEqual({
      operationalState: OpState.Error,
      operationalError: { errorStateId: OpError.DirtyWaterTankFull },
    })

    // Work state updates while the error stands do not hide it
    robotSends(control, 'WorkState', workState('cleaning', 'washing', 1))
    await settle()
    expect(api.state.rvcOperationalState).toMatchObject({ operationalState: OpState.Error })

    robotSends(control, 'Error', { code: [] })
    robotSends(control, 'WorkState', workState('cleaning', 'washing'))
    await settle()
    expect(api.state.rvcOperationalState).toEqual({
      operationalState: OpState.CleaningMop,
      operationalError: { errorStateId: OpError.NoError },
    })
  })

  it('ignores the library\'s own errors, such as an undecodable map message', async () => {
    const { api, control } = await setup()
    robotSends(control, 'WorkState', workState('idle'))
    control.emit('ChargeState', 'charging')
    control.emit('Error', 'Cannot read properties of undefined (reading \'split\')')
    await settle()
    expect(api.state.rvcOperationalState).toMatchObject({ operationalState: OpState.Charging })
  })

  it('offers the rooms of the current map only', async () => {
    const { api, control } = await setup()
    control.emit('Maps', {
      maps: [
        { mapID: '1129929481', mapName: 'Main', mapIsCurrentMap: true },
        { mapID: '1321206035', mapName: 'Guest office', mapIsCurrentMap: false },
      ],
    })
    expect(control.run).toHaveBeenCalledWith('Generic', 'getMapSet_V2', { mid: '1129929481', type: 'ar' })

    robotSends(control, 'MapSet_V2', { mid: '1129929481', type: 'ar', subsets: [['0', 'Stairs', '0'], ['2', 'Kitchen', '5']] })
    // Another map's rooms, and the current map's other layers, are not rooms to offer
    robotSends(control, 'MapSet_V2', { mid: '1321206035', type: 'ar', subsets: [['9', 'Office', '4']] })
    robotSends(control, 'MapSet_V2', { mid: '1129929481', type: 'vw', subsets: [] })
    await settle()

    expect(api.state.serviceArea).toMatchObject({
      supportedMaps: [{ mapId: 1129929481, name: 'Main' }],
      supportedAreas: [
        { areaId: 0, mapId: 1129929481, areaInfo: { locationInfo: { locationName: 'Stairs' } } },
        { areaId: 2, mapId: 1129929481, areaInfo: { locationInfo: { locationName: 'Kitchen' } } },
      ],
    })
  })

  it('does not act on the library\'s undecodable version of the room list', async () => {
    const { control } = await setup()
    control.emit('MapSpotAreas', { mapID: '1129929481', mapSpotAreas: Array.from({ length: 100 }, () => ({})) })
    control.emit('MapSpotAreaInfo', { mapID: '1129929481', mapSpotAreaID: '2' })
    await settle()
    expect(control.run).not.toHaveBeenCalled()
  })

  it('shows an offline robot as an error until it reports again', async () => {
    const { api, control } = await setup()
    control.emit('Error', 'Recipient unavailable')
    await settle()
    expect(api.state.rvcOperationalState).toMatchObject({ operationalState: OpState.Error })
    robotSends(control, 'WorkState', workState('cleaning'))
    await settle()
    expect(api.state.rvcOperationalState).toMatchObject({ operationalState: OpState.Running })
  })

  it('carries on with a paused clean when told to start', async () => {
    const { control, handlers } = await setup()
    robotSends(control, 'WorkState', workState('cleaning', 'idle', 1))
    await settle()
    await handlers.rvcRunMode.changeToMode({ newMode: 1 })
    expect(control.run.mock.calls).toEqual([['Generic', 'clean_V2', { act: 'resume', content: { type: 'auto' } }]])
  })

  it('cleans the selected rooms when told to start, and everywhere when none are', async () => {
    const { control, handlers } = await setup()
    control.emit('Maps', { maps: [{ mapID: '1129929481', mapName: 'Main', mapIsCurrentMap: true }] })
    robotSends(control, 'MapSet_V2', { mid: '1129929481', type: 'ar', subsets: [['0', 'Stairs', '0'], ['2', 'Kitchen', '5']] })
    await settle()
    control.run.mockClear()

    // Selecting rooms does not start a clean, and unknown rooms are dropped
    await handlers.serviceArea.selectAreas({ newAreas: [2, 7] })
    expect(control.run).not.toHaveBeenCalled()

    await handlers.rvcRunMode.changeToMode({ newMode: 1 })
    expect(control.run).toHaveBeenCalledWith('Generic', 'clean_V2', expect.objectContaining({
      content: expect.objectContaining({ type: 'freeClean', value: '1,2;' }),
    }))

    control.run.mockClear()
    await handlers.serviceArea.selectAreas({ newAreas: [] })
    await handlers.rvcRunMode.changeToMode({ newMode: 1 })
    expect(control.run).toHaveBeenCalledWith('Clean_V2')
  })

  it('pauses, resumes and sets the work mode with the commands the robot obeys', async () => {
    const { control, handlers } = await setup()
    await handlers.rvcOperationalState.pause()
    await handlers.rvcOperationalState.resume()
    await handlers.rvcCleanMode.changeToMode({ newMode: 2 })
    expect(control.run.mock.calls).toEqual([
      ['Generic', 'clean_V2', { act: 'pause' }],
      ['Generic', 'clean_V2', { act: 'resume', content: { type: 'auto' } }],
      ['Generic', 'setWorkMode', { mode: 2 }],
    ])
  })

  it('ends the clean before going home, so it does not wait at the station to resume', async () => {
    vi.useFakeTimers()
    const { control, handlers } = await setup()
    await handlers.rvcOperationalState.goHome()
    expect(control.run.mock.calls).toEqual([['Generic', 'clean_V2', { act: 'stop' }]])
    vi.advanceTimersByTime(1000)
    expect(control.run).toHaveBeenLastCalledWith('Charge')
  })

  it('follows the robot\'s work mode, whoever changes it', async () => {
    const { api, control } = await setup()
    robotSends(control, 'WorkMode', { mode: 1 })
    // Suction reports are not clean modes on this robot
    control.emit('CleanSpeed', 3)
    await settle()
    expect(api.state.rvcCleanMode).toEqual({ currentMode: 1 })
  })
})
