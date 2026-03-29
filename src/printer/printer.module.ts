import { Module } from '@nestjs/common';
import { PrinterService } from './printer.service';
import { PrinterController } from './printer.controller';
import { PrinterGateway } from './printer.gateway';

@Module({
  controllers: [PrinterController],
  providers: [PrinterService, PrinterGateway],
  exports: [PrinterService],
})
export class PrinterModule {}
