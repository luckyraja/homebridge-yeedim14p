/**
 * Support for robots that report their state through `getWorkState` /
 * `onWorkState` instead of `getCleanInfo_V2` - newer Yeedi models the stable
 * ecovacs-deebot library does not know.
 *
 * On these robots `getCleanInfo_V2` answers 'idle' for the whole of a clean and
 * `getChargeState` answers 'idle' whenever the robot is off the charger, so
 * neither can drive the Matter operational state. `getWorkState` does:
 *
 *   { paused: 0, robotState: { state: 'cleaning', ... }, stationState: { state: 'idle', ... } }
 *
 * The stable library has no commands or events for these messages, or for the
 * robot's work (vacuum/mop) mode and compressed room list, so they are requested
 * with Generic commands and read by tapping the MQTT client's raw message
 * handler - at the topic level, because pushes without the usual payload shape
 * are dropped before any event is emitted.
 *
 * Everything here was checked against a Yeedi M14 Plus.
 */

import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'

// Device classes that report state through getWorkState
//   6801mm - Yeedi M14 Plus
const WORK_STATE_DEVICE_CLASSES = new Set(['6801mm'])

/** Matter RvcOperationalState values */
const OpState = {
  Stopped: 0,
  Running: 1,
  Paused: 2,
  Error: 3,
  SeekingCharger: 64,
  Charging: 65,
  Docked: 66,
  EmptyingDustBin: 67,
  CleaningMop: 68,
} as const

/** Matter RvcOperationalState error ids */
const OpError = {
  NoError: 0,
  UnableToCompleteOperation: 2,
  WaterTankEmpty: 68,
  DirtyWaterTankFull: 74,
} as const

// Robot error codes with a Matter equivalent. Any other code is reported as
// UnableToCompleteOperation, which Matter controllers show as a general fault
const ROBOT_ERRORS: Record<number, number> = {
  322: OpError.WaterTankEmpty, // clean water tank low
  323: OpError.DirtyWaterTankFull,
}

// Room types the robot uses for an area with no name of its own (subtype 0 is
// the robot's lettered default, so it gets no type name)
const ROOM_TYPES: Record<string, string> = {
  1: 'Living Room',
  2: 'Dining Room',
  3: 'Bedroom',
  4: 'Study',
  5: 'Kitchen',
  6: 'Bathroom',
  7: 'Laundry',
  8: 'Lounge',
  9: 'Storeroom',
  10: 'Kids Room',
  11: 'Sunroom',
  12: 'Corridor',
  13: 'Balcony',
  14: 'Gym',
}

/**
 * The robot's work modes, which double as the Matter RvcCleanMode mode numbers.
 * Tag values are Matter RvcCleanMode tags: Vacuum 16385, Mop 16386,
 * VacuumThenMop 16387.
 */
const WORK_MODES = [
  { label: 'Vacuum & Mop', mode: 0, modeTags: [{ value: 16385 }, { value: 16386 }] },
  { label: 'Vacuum', mode: 1, modeTags: [{ value: 16385 }] },
  { label: 'Mop', mode: 2, modeTags: [{ value: 16386 }] },
  { label: 'Mop after Vacuum', mode: 3, modeTags: [{ value: 16387 }] },
]

interface WorkState {
  /** robotState.state - seen: 'cleaning', 'idle' */
  robot: string
  /** stationState.state - seen: 'idle', 'goCharging', 'goEmptying', 'emptying', 'washing', 'drying' */
  station: string
  paused: boolean
}

interface MatterWorkState {
  operationalState: number
  runMode: number
}

interface Room {
  areaId: number
  name: string
}

function isWorkStateDevice(deviceClass?: string): boolean {
  return WORK_STATE_DEVICE_CLASSES.has(deviceClass ?? '')
}

/**
 * Read the robot's work state from a getWorkState response or onWorkState push.
 *
 * @param data the message's `body.data`
 * @returns the work state, or undefined if the payload has no robot state
 */
function parseWorkState(data: any): WorkState | undefined {
  const robot = data?.robotState?.state
  if (typeof robot !== 'string' || robot === '') {
    return undefined
  }
  return {
    robot,
    station: typeof data.stationState?.state === 'string' ? data.stationState.state : '',
    paused: Number(data.paused) === 1 || data.paused === true,
  }
}

/**
 * The Matter state a work state means.
 *
 * Trips back to the station mid-clean (to empty the bin or wash the mop) keep
 * the robot's state as 'cleaning'; only the station state says where it is.
 *
 * @param state the robot's work state
 * @param charging whether the robot last reported itself as charging
 * @returns the Matter state, or undefined for a robot state never seen on a
 * real robot - left alone rather than guessed at
 */
function workStateToMatter(state: WorkState, charging: boolean): MatterWorkState | undefined {
  const runMode = state.robot === 'cleaning' ? 1 : 0
  switch (state.station) {
    case 'goCharging':
    case 'goEmptying':
      return { operationalState: OpState.SeekingCharger, runMode }
    case 'emptying':
      return { operationalState: OpState.EmptyingDustBin, runMode }
    case 'washing':
      // A paused clean waits at the station mid-wash (e.g. dirty tank full)
      return { operationalState: state.paused ? OpState.Paused : OpState.CleaningMop, runMode }
  }
  if (state.robot === 'cleaning') {
    return { operationalState: state.paused ? OpState.Paused : OpState.Running, runMode }
  }
  if (state.robot === 'idle') {
    // The robot reports itself as charging the whole time it sits on the
    // station, full battery included, so not charging means off the station
    return { operationalState: charging ? OpState.Charging : OpState.Stopped, runMode }
  }
  return undefined
}

/**
 * Read the robot's active error codes from a getError response or onError push
 * (`{ code: [323] }`, or `{ code: [] }` once cleared).
 */
function parseErrorCodes(data: any): number[] | undefined {
  if (!Array.isArray(data?.code)) {
    return undefined
  }
  return data.code.map(Number).filter((c: number) => Number.isInteger(c) && c > 0)
}

/** The Matter error id for a robot's active error codes. */
function errorCodesToMatter(codes: number[]): number {
  if (codes.length === 0) {
    return OpError.NoError
  }
  return ROBOT_ERRORS[codes[0]] ?? OpError.UnableToCompleteOperation
}

/** Read the work mode from a getWorkMode response or onWorkMode push. */
function parseWorkMode(data: any): number | undefined {
  const mode = Number(data?.mode)
  return WORK_MODES.some(m => m.mode === mode) ? mode : undefined
}

/**
 * Read the rooms from a getMapSet_V2 response or onMapSet_V2 push of type 'ar'.
 *
 * The rooms arrive as base64 zstd-compressed JSON, one array per room:
 * `[id, name, roomType, connections, index, ...]`.
 *
 * @param data the message's `body.data`
 * @returns the rooms, or undefined if the payload is not a room list or cannot
 * be decoded (zstd needs Node 22.15 or later)
 */
function parseRooms(data: any): Room[] | undefined {
  if (data?.type !== 'ar' || data.subsets === undefined) {
    return undefined
  }
  let subsets = data.subsets
  if (typeof subsets === 'string') {
    if (typeof zlib.zstdDecompressSync !== 'function') {
      return undefined
    }
    try {
      subsets = JSON.parse(zlib.zstdDecompressSync(Buffer.from(subsets, 'base64')).toString())
    } catch {
      return undefined
    }
  }
  if (!Array.isArray(subsets)) {
    return undefined
  }
  const rooms: Room[] = []
  for (const subset of subsets) {
    if (!Array.isArray(subset)) {
      continue
    }
    const areaId = Number(subset[0])
    if (!Number.isInteger(areaId) || areaId < 0) {
      continue
    }
    const name = String(subset[1] ?? '').trim() || ROOM_TYPES[String(subset[2])] || `Area ${areaId}`
    rooms.push({ areaId, name })
  }
  return rooms
}

/**
 * Call a handler with the `body.data` of every message the robot sends for the
 * given names, whether answering `get<Name>` or pushing `on<Name>`. The library
 * still handles each message as before.
 *
 * @param control the vacbot control object returned by `getVacBot`
 * @param handlers message name (e.g. 'WorkState') → handler
 * @returns false if the control object has no MQTT client to tap
 */
function tapMessages(control: any, handlers: Record<string, (data: any) => void>): boolean {
  const client = control?.ecovacs
  if (typeof client?.handleMessage !== 'function') {
    return false
  }
  const names = Object.keys(handlers).join('|')
  const pattern = new RegExp(`(?:^|/)(?:get|on)(${names})(?:/|$)`)
  const handleMessage = client.handleMessage.bind(client)
  client.handleMessage = (topic: string, message: any, type = 'incoming') => {
    const match = typeof topic === 'string' ? pattern.exec(topic) : null
    if (match) {
      try {
        const parsed = typeof message === 'string' ? JSON.parse(message) : message
        if (parsed?.body?.data !== undefined) {
          handlers[match[1]](parsed.body.data)
        }
      } catch {
        // A malformed message is the library's to report, not ours
      }
    }
    return handleMessage(topic, message, type)
  }
  return true
}

/** Ask the robot for its work state and errors; the answers arrive through tapMessages. */
function requestWorkState(control: any): void {
  control.run('Generic', 'getWorkState', {})
  control.run('Generic', 'getError', {})
}

/** Ask the robot for a map's rooms; the answer arrives through tapMessages. */
function requestRooms(control: any, mapId: string): void {
  control.run('Generic', 'getMapSet_V2', { mid: mapId, type: 'ar' })
}

/**
 * Commands for a work-state robot, as the payloads it was seen to accept. The
 * stable library's equivalents use the V1 clean command or room-clean types it
 * rejects ('unknown type').
 */
const workStateCommands = {
  pause: ['clean_V2', { act: 'pause' }],
  // Without the clean type the robot accepts the resume but stays paused
  resume: ['clean_V2', { act: 'resume', content: { type: 'auto' } }],
  // Charge alone leaves the clean paused at the station, to be resumed later
  stop: ['clean_V2', { act: 'stop' }],
  setWorkMode: (mode: number) => ['setWorkMode', { mode }],
  getWorkMode: ['getWorkMode', {}],
  cleanRooms: (areaIds: number[]) => ['clean_V2', {
    act: 'start',
    content: {
      count: 1,
      donotClean: '',
      type: 'freeClean',
      value: areaIds.map(id => `1,${id};`).join(''),
    },
    mode: '',
    router: 'plan',
  }],
} as const

export type { MatterWorkState, Room, WorkState }
export {
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
  WORK_MODES,
  WORK_STATE_DEVICE_CLASSES,
  workStateCommands,
  workStateToMatter,
}
