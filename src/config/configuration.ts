export default () => ({
  printer: {
    ip: process.env.PRINTER_IP,
    accessCode: process.env.PRINTER_ACCESS_CODE,
    serial: process.env.PRINTER_SERIAL,
  },
  port: parseInt(process.env.PORT, 10) || 3000,
});
