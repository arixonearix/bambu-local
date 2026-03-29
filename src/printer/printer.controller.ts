import {
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { PrinterService } from './printer.service';
import * as path from 'path';
import * as fs from 'fs';

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

@Controller('api')
export class PrinterController {
  constructor(private readonly printerService: PrinterService) {}

  @Get('status')
  getStatus() {
    return this.printerService.getStatus();
  }

  @Post('print')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadDir,
        filename: (req, file, cb) => {
          cb(null, file.originalname);
        },
      }),
    }),
  )
  async startPrint(@UploadedFile() file: Express.Multer.File) {
    let filePath = file.path;
    let filename = file.originalname;
    let slicedPath: string | null = null;

    try {
      if (filename.toLowerCase().endsWith('.stl')) {
        slicedPath = await this.printerService.sliceSTL(filePath);
        filePath = slicedPath;
        filename = path.basename(slicedPath);
      }

      await this.printerService.uploadFile(filePath, filename);
      await this.printerService.startPrint(filename);
      return { success: true, message: `Print started: ${filename}` };
    } catch (error) {
      return { success: false, message: error.message };
    } finally {
      // Clean up original upload
      fs.unlink(file.path, () => {});
      // Clean up renamed STL (if spaces were replaced)
      const safeName = file.originalname.replace(/\s+/g, '_');
      if (safeName !== file.originalname) {
        fs.unlink(path.join(path.dirname(file.path), safeName), () => {});
      }
      // Clean up sliced 3mf
      if (slicedPath) fs.unlink(slicedPath, () => {});
    }
  }

  @Post('light/on')
  lightOn() {
    this.printerService.setLight(true);
    return { success: true, message: 'Light turned on' };
  }

  @Post('light/off')
  lightOff() {
    this.printerService.setLight(false);
    return { success: true, message: 'Light turned off' };
  }

  @Post('stop')
  stopPrint() {
    this.printerService.stopPrint();
    return { success: true, message: 'Print stopped' };
  }

  @Post('pause')
  pausePrint() {
    this.printerService.pausePrint();
    return { success: true, message: 'Print paused' };
  }

  @Post('resume')
  resumePrint() {
    this.printerService.resumePrint();
    return { success: true, message: 'Print resumed' };
  }

  @Post('test-print')
  testPrint() {
    this.printerService.printGcodeFromPrinter('/cache/form-for-s2-bottle-str_plate_1.gcode');
    return { success: true, message: 'Test print command sent' };
  }

  @Post('test-gcode')
  testGcode() {
    this.printerService.sendGcodeLine('M17\n');
    return { success: true, message: 'Gcode line sent (M17 - enable steppers)' };
  }

  @Post('test-version')
  testVersion() {
    this.printerService.getVersion();
    return { success: true, message: 'Version request sent' };
  }

  @Post('test-pushall')
  testPushall() {
    this.printerService.requestStatus();
    return { success: true, message: 'Pushall sent - check logs' };
  }
}
