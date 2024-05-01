import envConfig from "./config";

const log = (...props: LogP) => {
  if (envConfig.NODE_ENV === "DEVELOPMENT") {
    // console.log(...props);
  }
};

const warn = (...props: LogP) => {
  if (envConfig.NODE_ENV === "DEVELOPMENT") {
    console.warn(...props);
  }
};

const err = (...props: LogP) => {
  if (envConfig.NODE_ENV === "DEVELOPMENT") {
    console.error(...props);
  }
};
/**
 * logger function to log in production
 * @params content to log
 */
const plog = (...props: LogP) => {
  // console.log(...props);
};
const Logger = { log, warn, err, plog };
export default Logger;
type LogP = any[];
