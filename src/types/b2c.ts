import { HttpStatusCode } from "axios";


export type TrackResponse = {
    status: 0 | 1; // most probably always 1, not sure for 0
    code: HttpStatusCode;
    message: string;
    data: {
      scans: any;
    };
  };
  export type RequiredTrackResponse = {
    request_order_id?: string;
    order_reference_id?: string;
    tracking_number?: string;
    carrier_name?: string;
    date_time?: string;
    location?: string;
    action?: string;
    status_code?: string;
    status_description?: string;
    order_date?: string;
    billing_name?: string;
  };