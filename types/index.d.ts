export type FoosballProfile = {
  rank: number
  wins: number
  losses: number
  streak: number
  bestStreak: number
  fastestKmh: number
  trophies: string[]
}

export type FoosballCommand = 'none' | 'up' | 'down' | 'shoot' | 'pause' | 'restart' | 'mode'

export type FoosballControl = { seq: number; cmd: FoosballCommand }

export type FoosballPlayer = { id: string; name: string; rating: number; wins: number; losses: number; ver: number }

export type FoosballNet = {
  view: 'cpu' | 'office'
  status: 'off' | 'starting' | 'idle' | 'hosting' | 'connecting' | 'playing'
  error: string
  me: FoosballPlayer | null
  peer: FoosballPlayer | null
  role: 'host' | 'guest' | null
  addresses: string[]
  lobby: (FoosballPlayer & { table: { address: string; port: number } | null })[]
  board: (FoosballPlayer & { place: number; online: boolean })[]
  myPlace: number
}

declare module 'claude-code' {
  interface PluginState {
    foosball: { profile: FoosballProfile; control: FoosballControl; net: FoosballNet }
  }
}
