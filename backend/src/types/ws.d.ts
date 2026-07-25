declare module 'ws' {
  import { Server as HttpServer } from 'http'
  import { IncomingMessage } from 'http'
  import { Duplex } from 'stream'

  class WebSocket {
    static OPEN: number
    readyState: number
    send(data: string): void
    on(event: string, listener: (...args: any[]) => void): this
    close(code?: number, reason?: string): void
  }

  class WebSocketServer {
    constructor(options: { server: HttpServer })
    on(event: 'connection', listener: (ws: WebSocket, req: IncomingMessage) => void): this
  }

  export { WebSocket, WebSocketServer }
}