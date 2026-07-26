import type { PluginAPI, ThreadID } from '@ampcode/plugin'

type CompanionState = 'idle' | 'running' | 'awaiting-approval' | 'error' | 'done' | 'cancelled'
type Phase = 'idle' | 'working' | 'thinking' | 'researching' | 'editing' | 'testing' | 'shipping' | 'error' | 'done' | 'cancelled'

type BridgeConfig = {
  host: '127.0.0.1'
  port: 17373
  token: string
}

type ThreadCommand = {
  version: 2
  type: 'thread.command'
  commandID: string
  threadID: string
  command: 'append' | 'acknowledge'
  content?: string
  intent?: 'shipping'
}

type CommandResult = {
  version: 2
  type: 'thread.command.result'
  commandID: string
  threadID: string
  ok: boolean
  error?: 'invalid_command' | 'command_failed'
}

type Challenge = { version: 2; type: 'hello.challenge'; clientNonce: string; serverNonce: string; proof: string }
type Acknowledgement = { version: 2; type: 'hello.ack'; serverNonce: string; proof: string }

type WatchedThread = {
  id: ThreadID
  state: CompanionState
  phase: Phase
  unread: boolean
}

const reconnectMinimumMs = 1_000
const reconnectMaximumMs = 30_000
const authenticationTimeoutMs = 5_000
const maximumRememberedCommands = 100
const shippingStartTimeoutMs = 30_000

export default function streamDeckCompanion(amp: PluginAPI) {
  if (process.env.AMP_DECK_DISABLE_COMPANION === '1') return

  const watched = new Map<string, WatchedThread>()
  const shippingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const clientId = `amp-deck-${crypto.randomUUID()}`
  const executorKind = amp.system.executor.kind === 'local' || amp.system.executor.kind === 'remote'
    ? amp.system.executor.kind : 'unknown'
  let socket: WebSocket | undefined
  let authenticated = false
  let reconnectDelay = reconnectMinimumMs
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  const commandResults = new Map<string, Promise<CommandResult>>()

  const log = (message: string) => amp.logger.log(`[Amp Deck] ${message}`)

  function send(value: unknown): void {
    if (authenticated && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(value))
    }
  }

  function sendTo(source: WebSocket, value: unknown): void {
    if (authenticated && socket === source && source.readyState === WebSocket.OPEN) {
      source.send(JSON.stringify(value))
    }
  }

  function emitStatus(thread: WatchedThread): void {
    send({
      version: 2,
      type: 'thread.status',
      threadID: thread.id,
      state: thread.state,
      phase: thread.phase,
      executorKind,
      unread: thread.unread,
    })
  }

  function setPhase(id: ThreadID, phase: Phase, state?: CompanionState): void {
    if (phase !== 'shipping') clearShippingTimer(id)
    void watchThread(id).then((thread) => {
      thread.phase = phase
      if (state) thread.state = state
      emitStatus(thread)
    })
  }

  function clearShippingTimer(id: string): void {
    const timer = shippingTimers.get(id)
    if (timer) clearTimeout(timer)
    shippingTimers.delete(id)
  }

  function setShippingPhase(id: ThreadID): void {
    clearShippingTimer(id)
    setPhase(id, 'shipping', 'running')
    shippingTimers.set(id, setTimeout(() => {
      shippingTimers.delete(id)
      void watchThread(id).then((thread) => {
        if (thread.phase !== 'shipping') return
        thread.phase = thread.state === 'running' ? 'working' : 'idle'
        emitStatus(thread)
      })
    }, shippingStartTimeoutMs))
  }

  async function watchThread(id: ThreadID): Promise<WatchedThread> {
    const existing = watched.get(id)
    if (existing) return existing

    const value: WatchedThread = { id, state: 'idle', phase: 'idle', unread: false }
    watched.set(id, value)
    const thread = amp.threads.get(id)

    thread.state.subscribe((state) => {
      if (state === 'idle' || state === 'running' || state === 'awaiting-approval' || state === 'error') {
        value.state = state
        if (state === 'running' && value.phase === 'idle') value.phase = 'working'
        if (state === 'awaiting-approval') value.phase = 'working'
        if (state === 'error') value.phase = 'error'
        if (state === 'idle' && value.phase !== 'done') value.phase = 'idle'
        emitStatus(value)
      }
    })

    // Observable subscriptions do not promise an initial emission.
    try {
      const state = await thread.state.get()
      if (state === 'idle' || state === 'running' || state === 'awaiting-approval' || state === 'error') {
        value.state = state
        if (state === 'running') value.phase = 'working'
        else if (state === 'error') value.phase = 'error'
        else if (state === 'idle' && value.phase !== 'done') value.phase = 'idle'
      }
    } catch {
      // A newly observed remote thread may not have loaded its metadata yet.
    }
    emitStatus(value)
    return value
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return
    const delay = reconnectDelay
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaximumMs)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connect()
    }, delay)
  }

  async function readConfig(): Promise<BridgeConfig | undefined> {
    try {
      const home = process.env.HOME || process.env.USERPROFILE
      if (!home) return undefined
      const raw: unknown = await Bun.file(`${home}/.config/amp-deck/bridge.json`).json()
      if (!isRecord(raw) || raw.version !== 2 || raw.host !== '127.0.0.1' || raw.port !== 17373 ||
          !isHex(raw.token, 64)) return undefined
      return { host: '127.0.0.1', port: 17373, token: raw.token }
    } catch {
      return undefined
    }
  }

  async function connect(): Promise<void> {
    const config = await readConfig()
    if (!config) {
      log('bridge config unavailable; retrying')
      scheduleReconnect()
      return
    }

    log(`connecting to ws://${config.host}:${config.port}`)
    const candidate = new WebSocket(`ws://${config.host}:${config.port}`)
    socket = candidate
    authenticated = false
    const clientNonce = randomHex(32)
    let serverNonce: string | undefined
    const authenticationTimer = setTimeout(() => candidate.close(4001, 'Authentication timeout'), authenticationTimeoutMs)
    candidate.addEventListener('open', () => {
      candidate.send(JSON.stringify({ version: 2, type: 'hello', clientId, clientNonce }))
    })
    candidate.addEventListener('message', (event) => {
      const message = parseBridgeMessage(event.data)
      if (!message) return candidate.close(4002, 'Invalid protocol message')
      void (async () => {
        if (socket !== candidate) return
        if (message.type === 'hello.challenge' && !authenticated && serverNonce === undefined &&
            message.clientNonce === clientNonce &&
            await proofMatches(config.token, message.proof, 'server', clientId, clientNonce, message.serverNonce)) {
          serverNonce = message.serverNonce
          candidate.send(JSON.stringify({
            version: 2, type: 'hello.authenticate', clientId, clientNonce, serverNonce,
            proof: await proof(config.token, 'client', clientId, clientNonce, serverNonce),
          }))
          return
        }
        if (message.type === 'hello.ack' && !authenticated && serverNonce !== undefined &&
            message.serverNonce === serverNonce &&
            await proofMatches(config.token, message.proof, 'ack', clientId, clientNonce, serverNonce)) {
          authenticated = true
          clearTimeout(authenticationTimer)
          reconnectDelay = reconnectMinimumMs
          log('connected and authenticated')
          for (const thread of watched.values()) emitStatus(thread)
          return
        }
        if (message.type === 'thread.command' && authenticated) {
          void executeCommand(candidate, message)
          return
        }
        candidate.close(4003, 'Authentication failed')
      })().catch(() => candidate.close(4003, 'Authentication failed'))
    })
    candidate.addEventListener('error', () => log('connection error'))
    candidate.addEventListener('close', () => {
      clearTimeout(authenticationTimer)
      if (socket !== candidate) return
      socket = undefined
      authenticated = false
      log('disconnected; retrying')
      scheduleReconnect()
    })
  }

  async function executeCommand(source: WebSocket, command: ThreadCommand): Promise<void> {
    let result = commandResults.get(command.commandID)
    if (!result) {
      result = (async (): Promise<CommandResult> => {
        let error: CommandResult['error']
        try {
          if (command.command === 'acknowledge') {
            const watchedThread = await watchThread(command.threadID as ThreadID)
            watchedThread.unread = false
            emitStatus(watchedThread)
          } else if (command.content === undefined || command.content.trim().length === 0) {
            error = 'invalid_command'
          } else {
            const thread = amp.threads.get(command.threadID as ThreadID)
            await thread.appendUserMessage(
              { type: 'user-message', content: command.content! },
            )
          }
        } catch {
          error = 'command_failed'
          log('command failed')
        }
        return { version: 2, type: 'thread.command.result', commandID: command.commandID,
          threadID: command.threadID, ok: error === undefined, ...(error ? { error } : {}) }
      })()

		result.then((commandResult) => {
			if (commandResult.ok) {
				if (command.intent === 'shipping') {
					setShippingPhase(command.threadID as ThreadID)
				} else {
					void watchThread(command.threadID as ThreadID).catch(() => log('status watch failed'))
				}
			}
		})
      commandResults.set(command.commandID, result)
      if (commandResults.size > maximumRememberedCommands) {
        commandResults.delete(commandResults.keys().next().value as string)
      }
    }
    sendTo(source, await result)
  }

  amp.activeThread.subscribe((thread) => {
    if (thread) void watchThread(thread.id).then((watchedThread) => {
      watchedThread.unread = false
      emitStatus(watchedThread)
    })
  })
  if (amp.activeThread.current) void watchThread(amp.activeThread.current.id)

  amp.on('session.start', (event) => { void watchThread(event.thread.id) })
  amp.on('agent.start', (event) => { setPhase(event.thread.id, 'thinking', 'running') })
  amp.on('tool.result', (event) => {
    setPhase(event.thread.id, event.status === 'error' ? 'error' : classifyTool(event.tool), event.status === 'error' ? 'error' : 'running')
    // Deliberately return nothing so the tool result is not modified.
  })
  amp.on('agent.end', (event) => {
    clearShippingTimer(event.thread.id)
    void watchThread(event.thread.id).then((thread) => {
      thread.unread = amp.activeThread.current?.id !== event.thread.id
      thread.phase = event.status
      thread.state = event.status
      emitStatus(thread)
    })
  })

  void connect()
}

function classifyTool(name: string): Phase {
  const tool = name.toLowerCase()
  if (/(test|spec|check|lint|typecheck|verify)/.test(tool)) return 'testing'
  if (/(edit|write|patch|create|delete|move|rename|format)/.test(tool)) return 'editing'
  if (/(search|find|read|view|browse|web|fetch|grep|glob|oracle)/.test(tool)) return 'researching'
  return 'working'
}

function parseBridgeMessage(value: unknown): Challenge | Acknowledgement | ThreadCommand | undefined {
  try {
    if (typeof value !== 'string') return undefined
    const message: unknown = JSON.parse(value)
    if (!isRecord(message) || message.version !== 2 || typeof message.type !== 'string') return undefined
    if (message.type === 'hello.challenge') return isHex(message.clientNonce, 64) && isHex(message.serverNonce, 64) && isHex(message.proof, 64) ? message as Challenge : undefined
    if (message.type === 'hello.ack') return isHex(message.serverNonce, 64) && isHex(message.proof, 64) ? message as Acknowledgement : undefined
    if (message.type !== 'thread.command' || typeof message.commandID !== 'string' || message.commandID.length === 0 ||
        message.commandID.length > 64 || !isThreadId(message.threadID) ||
        (message.command !== 'append' && message.command !== 'acknowledge') ||
        (message.command === 'acknowledge' && message.content !== undefined) ||
        (message.intent !== undefined && (message.intent !== 'shipping' || message.command !== 'append')) ||
        (message.content !== undefined && (typeof message.content !== 'string' || message.content.length > 4096))) return undefined
    return message as ThreadCommand
  } catch {
    return undefined
  }
}

function isThreadId(value: unknown): value is string {
  return typeof value === 'string' && /^T-[a-zA-Z0-9-]{8,}$/.test(value) && value.length <= 80
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value)
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), value => value.toString(16).padStart(2, '0')).join('')
}

async function proof(token: string, role: string, clientId: string, clientNonce: string, serverNonce: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${role}|${clientId}|${clientNonce}|${serverNonce}`))
  return Array.from(new Uint8Array(signature), value => value.toString(16).padStart(2, '0')).join('')
}

async function proofMatches(token: string, actual: string, role: string, clientId: string, clientNonce: string, serverNonce: string): Promise<boolean> {
  const expected = await proof(token, role, clientId, clientNonce, serverNonce)
  let difference = actual.length ^ expected.length
  for (let index = 0; index < expected.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  return difference === 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
