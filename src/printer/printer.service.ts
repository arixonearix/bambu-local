import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import { Client as FtpClient } from 'basic-ftp';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';

const execFileAsync = promisify(execFile);

@Injectable()
export class PrinterService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrinterService.name);
  private mqttClient: mqtt.MqttClient;
  private printerIp: string;
  private accessCode: string;
  private serial: string;
  private sequenceId = 0;
  private currentStatus: any = {};

  constructor(private configService: ConfigService) {
    super();
    this.printerIp = this.configService.get<string>('printer.ip');
    this.accessCode = this.configService.get<string>('printer.accessCode');
    this.serial = this.configService.get<string>('printer.serial');
  }

  async onModuleInit() {
    this.connectMqtt();
  }

  async onModuleDestroy() {
    if (this.mqttClient) {
      this.mqttClient.end();
    }
  }

  private connectMqtt() {
    const url = `mqtts://${this.printerIp}:8883`;
    this.logger.log(`Connecting to printer MQTT at ${url}`);

    this.mqttClient = mqtt.connect(url, {
      username: 'bblp',
      password: this.accessCode,
      clientId: `studio_client_${Date.now()}`,
      protocolVersion: 4,
      rejectUnauthorized: false,
      reconnectPeriod: 5000,
    });

    this.mqttClient.on('connect', () => {
      this.logger.log('MQTT connected');
      const topic = `device/${this.serial}/report`;
      this.mqttClient.subscribe(topic, (err) => {
        if (err) {
          this.logger.error(`Failed to subscribe to ${topic}`, err.message);
        } else {
          this.logger.log(`Subscribed to ${topic}`);
          this.requestFullStatus();
        }
      });
    });

    this.mqttClient.on('message', (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        this.logger.debug(`MQTT full message: ${JSON.stringify(data).substring(0, 2000)}`);
        if (data.info) {
          this.logger.log(`INFO response: ${JSON.stringify(data.info).substring(0, 500)}`);
        }
        if (data.print) {
          if (data.print.command) {
            this.logger.log(`Printer response: command=${data.print.command} result=${data.print.result} reason=${data.print.reason} gcode_state=${data.print.gcode_state}`);
          }
          if (data.print.gcode_state) {
            this.logger.log(`Printer state: ${data.print.gcode_state} | progress: ${data.print.mc_percent}%`);
          }
          this.currentStatus = { ...this.currentStatus, ...data.print };
          this.emit('status', this.currentStatus);
        }
      } catch (e) {
        this.logger.warn('Failed to parse MQTT message');
      }
    });

    this.mqttClient.on('error', (err) => {
      this.logger.error('MQTT error', err.message);
    });

    this.mqttClient.on('close', () => {
      this.logger.warn('MQTT connection closed');
    });
  }

  private publish(payload: object) {
    const topic = `device/${this.serial}/request`;
    const msg = JSON.stringify(payload);
    this.logger.log(`Publishing to ${topic}: ${msg}`);
    this.mqttClient.publish(topic, msg);
  }

  requestStatus() {
    this.requestFullStatus();
  }

  private requestFullStatus() {
    this.publish({
      pushing: {
        sequence_id: String(this.sequenceId++),
        command: 'pushall',
        version: 1,
        push_target: 1,
      },
    });
  }

  async sliceSTL(stlPath: string): Promise<string> {
    const outputDir = path.dirname(stlPath);
    const baseName = path.basename(stlPath, '.stl');
    const outputPath = path.join(outputDir, `${baseName}.3mf`);
    const profilesDir = path.join(process.cwd(), 'profiles');

    this.logger.log(`Slicing ${stlPath} → ${outputPath}`);

    const settingsFiles = [
      path.join(profilesDir, 'print.json'),
      path.join(profilesDir, 'printer.json'),
    ].join(';');

    const args = [
      '--slice', '0',
      '--export-3mf', outputPath,
      '--load-settings', settingsFiles,
      '--load-filaments', path.join(profilesDir, 'filament.json'),
      stlPath,
    ];

    try {
      const { stdout, stderr } = await execFileAsync('orca-slicer', args, {
        timeout: 120000,
      });
      if (stderr) this.logger.warn(`Slicer stderr: ${stderr}`);
      this.logger.log(`Slicing complete: ${outputPath}`);
      return outputPath;
    } catch (error) {
      this.logger.error(`Slicing failed: ${error.message}`);
      throw new Error(`Slicing failed: ${error.message}`);
    }
  }

  getStatus() {
    return this.currentStatus;
  }

  async uploadFile(filePath: string, remoteFilename: string): Promise<string> {
    const ftp = new FtpClient();
    ftp.ftp.verbose = false;

    // Compute MD5 of the file
    const fileBuffer = fs.readFileSync(filePath);
    const md5 = crypto.createHash('md5').update(fileBuffer).digest('hex');
    this.logger.log(`File MD5: ${md5}`);

    try {
      await ftp.access({
        host: this.printerIp,
        port: 990,
        user: 'bblp',
        password: this.accessCode,
        secure: 'implicit',
        secureOptions: { rejectUnauthorized: false },
      });
      this.logger.log(`FTP connected, uploading ${remoteFilename}`);
      await ftp.uploadFrom(filePath, `/${remoteFilename}`);
      this.logger.log(`Upload complete: /${remoteFilename}`);
    } finally {
      ftp.close();
    }

    return md5;
  }

  async startPrint(filename: string, md5 = ''): Promise<void> {
    this.logger.log(`Starting print: ${filename}`);

    const is3mf = filename.toLowerCase().endsWith('.3mf');

    const printPayload = {
      print: {
        sequence_id: String(this.sequenceId++),
        command: 'project_file',
        param: is3mf ? 'Metadata/plate_1.gcode' : '',
        subtask_name: filename,
        url: `ftp://${filename}`,
        bed_type: 'auto',
        timelapse: false,
        bed_leveling: true,
        flow_cali: true,
        vibration_cali: true,
        layer_inspect: false,
        use_ams: false,
        profile_id: '0',
        project_id: '0',
        task_id: '0',
        file: '',
        md5: md5,
      },
    };

    this.publish(printPayload);
  }

  printGcodeFromPrinter(path: string): void {
    this.logger.log(`Printing gcode from printer path: ${path}`);
    this.publish({
      print: {
        sequence_id: String(this.sequenceId++),
        command: 'gcode_file',
        param: path,
      },
    });
  }

  sendGcodeLine(gcode: string): void {
    this.logger.log(`Sending gcode line: ${gcode}`);
    this.publish({
      print: {
        sequence_id: String(this.sequenceId++),
        command: 'gcode_line',
        param: gcode,
      },
    });
  }

  getVersion(): void {
    this.logger.log('Requesting firmware version');
    this.publish({
      info: {
        sequence_id: String(this.sequenceId++),
        command: 'get_version',
      },
    });
  }

  setLight(on: boolean): void {
    this.logger.log(`Setting light: ${on ? 'ON' : 'OFF'}`);
    this.publish({
      system: {
        sequence_id: String(this.sequenceId++),
        command: 'ledctrl',
        led_node: 'chamber_light',
        led_mode: on ? 'on' : 'off',
        led_on_time: 500,
        led_off_time: 500,
        loop_times: 0,
        interval_time: 0,
      },
    });
  }

  stopPrint(): void {
    this.logger.log('Stopping print');
    this.publish({
      print: {
        sequence_id: String(this.sequenceId++),
        command: 'stop',
      },
    });
  }

  pausePrint(): void {
    this.logger.log('Pausing print');
    this.publish({
      print: {
        sequence_id: String(this.sequenceId++),
        command: 'pause',
      },
    });
  }

  resumePrint(): void {
    this.logger.log('Resuming print');
    this.publish({
      print: {
        sequence_id: String(this.sequenceId++),
        command: 'resume',
      },
    });
  }
}
