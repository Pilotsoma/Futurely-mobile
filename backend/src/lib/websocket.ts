import { WebSocket } from 'ws'

// All connected clients (for broadcast)
export const clients = new Set<WebSocket>()

// userId → set of connections (for targeted delivery)
export const userClients = new Map<number, Set<WebSocket>>()

export const broadcast = (event: string, data: unknown) => {
  const message = JSON.stringify({ event, data })
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message)
  })
}

export const sendToUser = (userId: number, event: string, data: unknown) => {
  const connections = userClients.get(userId)
  if (!connections) return
  const message = JSON.stringify({ event, data })
  connections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message)
  })
}

export const sendToSession = (participantUserIds: number[], event: string, data: unknown) => {
  const message = JSON.stringify({ event, data })
  participantUserIds.forEach(userId => {
    const connections = userClients.get(userId)
    if (!connections) return
    connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(message)
    })
  })
}

// Battle session tracking
export const playerSessions = new Map<number, string>()          // userId → joinCode
export const sessionPlayers = new Map<string, Set<number>>()     // joinCode → Set<userId>
export const sessionAlive   = new Map<string, Set<number>>()     // joinCode → alive userId set
export const sessionHealth  = new Map<string, Map<number, number>>() // joinCode → userId → hp
export const sessionAmmo    = new Map<string, Map<number, number>>() // joinCode → userId → ammo
export const sessionStartTime = new Map<string, number>()        // joinCode → startTime ms

export const BATTLE_START_HP   = 100
export const BATTLE_START_AMMO = 10
export const BATTLE_MAX_AMMO   = 30
export const BATTLE_AMMO_REWARD = 5

export function registerBattlePlayers(userIds: number[], code: string) {
  if (!sessionPlayers.has(code)) sessionPlayers.set(code, new Set())
  if (!sessionAlive.has(code))   sessionAlive.set(code, new Set())
  if (!sessionHealth.has(code))  sessionHealth.set(code, new Map())
  if (!sessionAmmo.has(code))    sessionAmmo.set(code, new Map())
  if (!sessionStartTime.has(code)) sessionStartTime.set(code, Date.now())
  userIds.forEach(uid => {
    playerSessions.set(uid, code)
    sessionPlayers.get(code)!.add(uid)
    sessionAlive.get(code)!.add(uid)
    if (!sessionHealth.get(code)!.has(uid)) sessionHealth.get(code)!.set(uid, BATTLE_START_HP)
    if (!sessionAmmo.get(code)!.has(uid))   sessionAmmo.get(code)!.set(uid, BATTLE_START_AMMO)
  })
}

export function sendToSessionExcept(code: string, exceptId: number, event: string, data: unknown) {
  const players = sessionPlayers.get(code)
  if (!players) return
  players.forEach(uid => { if (uid !== exceptId) sendToUser(uid, event, data) })
}

export function sendToAllInSession(code: string, event: string, data: unknown) {
  const players = sessionPlayers.get(code)
  if (!players) return
  players.forEach(uid => sendToUser(uid, event, data))
}
