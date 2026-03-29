import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrinterService } from './printer.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class PrinterGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PrinterGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly printerService: PrinterService) {
    this.printerService.on('status', (status) => {
      this.server?.emit('status', status);
    });
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    client.emit('status', this.printerService.getStatus());
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }
}
