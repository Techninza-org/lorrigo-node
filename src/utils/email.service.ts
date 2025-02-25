import nodemailer from 'nodemailer';
import envConfig from './config';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { json2csv } from 'json-2-csv';

class EmailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: envConfig.SMTP_ID,
        pass: envConfig.SMTP_PASS,
      },
    });
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"Lorrigo Logistic" <${envConfig.SMTP_ID}>`,
        to,
        subject,
        html,
      });
    } catch (error: any) {
      console.error("Email sending failed:", error);
      throw new Error('Email sending failed: ' + error.message);
    }
  }

  async generateCSV(data: object[], fileName: string): Promise<string> {
    try {
      const tempDir = os.tmpdir();
      const filePath = path.join(tempDir, `${fileName}.csv`);
      const csv = json2csv(data);
      await fs.writeFile(filePath, csv, 'utf8');
      return filePath;
    } catch (error: any) {
      console.error("CSV Generation Error:", error);
      throw new Error('CSV generation failed: ' + error.message);
    }
  }

  async sendEmailWithCSV(
    to: string,
    subject: string,
    html: string,
    csvData: object[],
    fileName: string,
    pdfBuffer: any,
    pdfFileName: string
  ): Promise<void> {
    let csvFilePath: string | null = null;
    try {
      csvFilePath = await this.generateCSV(csvData, fileName);

      await this.transporter.sendMail({
        from: `"Lorrigo Logistic" <${envConfig.SMTP_ID}>`,
        to,
        subject,
        html,
        attachments: [
          {
            filename: `${fileName}.csv`,
            path: csvFilePath,
          },
          {
            filename: pdfFileName,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });

      console.log("Email sent successfully to:", to);
    } catch (error: any) {
      console.error("Email sending failed:", error);
      throw new Error('Email with CSV attachment failed: ' + error.message);
    } finally {
      if (csvFilePath) {
        try {
          await fs.unlink(csvFilePath);
          console.log("CSV file deleted:", csvFilePath);
        } catch (err) {
          console.warn("Failed to delete CSV file:", csvFilePath, err);
        }
      }
    }
  }
}

export default new EmailService();
