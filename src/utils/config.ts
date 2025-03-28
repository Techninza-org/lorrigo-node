import * as dotenv from "dotenv";

dotenv.config();

const NODE_ENV = process.env.NODE_ENV;

const LORRIGO_DOMAIN = process.env.LORRIGO_DOMAIN;

const MONGODB_URI = NODE_ENV === "PRODUCTION" ? process.env.PRO_MONGODB_URI : process.env.MONGODB_URI;

const SALT_ROUND = Number(process.env.SALT_ROUND) || 10;

const PORT = Number(process.env.PORT) || 8000;

const JWT_SECRET = process.env.JWT_SECRET;

const SMTP_ID = process.env.SMTP_ID;
const SMTP_PASS = process.env.SMTP_PASS;

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

const SMART_SHIP_USERNAME = "logistics@lorrigo.com";

const SMART_SHIP_PASSWORD = process.env.PASSWORD;

const SMART_SHIP_CLIENT_ID = process.env.CLIENT_ID;

const SMART_SHIP_CLIENT_SECRET = process.env.CLIENT_SECRET;

const SMART_SHIP_GRANT_TYPE = process.env.GRANT_TYPE;

const SMART_SHIP_API_BASEURL = process.env.SMARTSHIP_API_BASEURL;

/* SMARTR */

const SMARTR_API_BASEURL = process.env.SMARTR_API_BASEURL;

const SMARTR_USERNAME = process.env.SMARTR_USERNAME;

const SMARTR_PASSWORD = process.env.SMARTR_PASSWORD;

/* SHIPROCKET */

const SHIPROCKET_USERNAME = process.env.SHIPROCKET_USERNAME;

const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;

const SHIPROCKET_API_BASEURL = process.env.SHIPROCKET_API_BASEURL;

const SHIPROCKET_API_KEY = process.env.SHIPROCKET_API_KEY;

/* PHONEPE */

const PHONEPE_API_BASEURL = process.env.PHONEPE_API_BASEURL;

const PHONEPE_MERCHENT_ID = process.env.PHONEPE_MERCHENT_ID;

const PHONEPE_SALT_INDEX = process.env.PHONEPE_SALT_INDEX;

const PHONEPE_SALT_KEY = process.env.PHONEPE_SALT_KEY;

const PHONEPE_SUCCESS_URL = process.env.PHONEPE_SUCCESS_URL;

const PHONEPE_FAILURE_URL = process.env.PHONEPE_SUCCESS_URL;

/* DELHIVERY */

const DELHIVERY_API_BASEURL = process.env.DELHIVERY_API_BASEURL;
const DELHIVERY_API_TOKEN = process.env.DELHIVERY_API_TOKEN;


/* ZOHO */
const ZOHO_API_BASEURL = process.env.ZOHO_API_BASEURL;
const ZOHO_ORG_ID = process.env.ZOHO_ORG_ID;
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;

/* MARUTI */
const MARUTI_BASEURL = process.env.MARUTI_BASEURL;
const MARUTI_USERNAME = process.env.MARUTI_USERNAME;
const MARUTI_PASSWORD = process.env.MARUTI_PASSWORD;
const MARUTI_REFRESH_TOKEN = process.env.MARUTI_REFRESH_TOKEN;


/*SHIPROCKET B2B*/
const SHIPROCKET_B2B_API_BASEURL = process.env.SHIPROCKET_B2B_API_BASEURL;

const envConfig = {
  NODE_ENV,
  MONGODB_URI,
  SALT_ROUND,
  PORT,
  JWT_SECRET,
  ADMIN_JWT_SECRET,
  SMART_SHIP_USERNAME,
  SMART_SHIP_PASSWORD,
  SMART_SHIP_CLIENT_ID,
  SMART_SHIP_CLIENT_SECRET,
  SMART_SHIP_GRANT_TYPE,
  SMART_SHIP_API_BASEURL,
  SMARTR_USERNAME,
  SMARTR_PASSWORD,

  SHIPROCKET_USERNAME,
  SHIPROCKET_PASSWORD,
  SHIPROCKET_API_BASEURL,

  SMARTR_API_BASEURL,

  PHONEPE_API_BASEURL,
  PHONEPE_MERCHENT_ID,
  PHONEPE_SALT_INDEX,
  PHONEPE_SALT_KEY,
  PHONEPE_SUCCESS_URL,
  PHONEPE_FAILURE_URL,
  LORRIGO_DOMAIN,


  DELHIVERY_API_BASEURL,
  DELHIVERY_API_TOKEN,

  ZOHO_API_BASEURL,
  ZOHO_ORG_ID,
  ZOHO_CLIENT_ID,
  ZOHO_CLIENT_SECRET,
  ZOHO_REFRESH_TOKEN,

  MARUTI_BASEURL,
  MARUTI_USERNAME,
  MARUTI_PASSWORD,
  MARUTI_REFRESH_TOKEN,

  SHIPROCKET_B2B_API_BASEURL,
  SMTP_ID,
  SMTP_PASS,

};

export default envConfig;