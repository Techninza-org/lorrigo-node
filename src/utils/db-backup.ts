import { exec } from "child_process";
import fs from "fs";
import archiver from "archiver";

const connectionString = "mongodb://localhost:27017/mydatabase"; // Replace with your connection string
const dumpDir = "./dump"; // Directory to store the dump files
const zipFileName = "mydatabase.zip"; // Name of the final zip file

// Utility function to run shell commands
function runCommand(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command}`);
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${stderr}`);
        reject(error);
        return;
      }
      console.log(stdout);
      resolve();
    });
  });
}

// Step 1: Run mongodump to export the database
async function exportDatabase(): Promise<void> {
  const command = `mongodump --uri="${connectionString}" --out="${dumpDir}"`;
  await runCommand(command);
  console.log("Database export completed.");
}

// Step 2: Compress the dump directory into a zip file
async function compressDump(): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipFileName);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`Database compressed into ${zipFileName} (${archive.pointer()} total bytes)`);
      resolve();
    });

    archive.on("error", (err) => {
      console.error("Compression error:", err);
      reject(err);
    });

    archive.pipe(output);
    archive.directory(dumpDir, false);
    archive.finalize();
  });
}

// Step 3: Clean up the dump directory
function cleanUp(): void {
  if (fs.existsSync(dumpDir)) {
    fs.rmSync(dumpDir, { recursive: true, force: true });
    console.log("Temporary dump directory removed.");
  }
}

// Main function to export and compress the database
async function main(): Promise<void> {
  try {
    console.log("Starting database export...");
    await exportDatabase();
    console.log("Starting compression...");
    await compressDump();
    console.log("Cleaning up...");
    cleanUp();
    console.log("Database export and compression completed!");
  } catch (err) {
    console.error("An error occurred:", err);
  }
}

// Execute the main function
main();
