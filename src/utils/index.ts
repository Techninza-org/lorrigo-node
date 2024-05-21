import { Types } from "mongoose";
import { B2COrderModel } from "../models/order.model";
import nodemailer from "nodemailer";
import { startOfWeek, addDays } from "date-fns";
import { validateEmail } from "./helpers";


export function calculateShipmentDetails(orders: any[]) {
  let totalShipments: any[] = [];
  let pickupPending = 0;
  let inTransit = 0;
  let delivered = 0;
  let rto = 0;

  orders.forEach((order) => {
    totalShipments.push(order);
    switch (order.bucket) {
      case 0:
        pickupPending++;
        break;
      case (2, 3, 4):
        pickupPending++;
        break;
      case (27, 30):
        inTransit++;
        break;
      case 11:
        delivered++;
        break;
      case (18, 19):
        rto++;
        break;
      default:
        break;
    }
  });

  return { totalShipments, pickupPending, inTransit, delivered, ndrPending: 0, rto: 0 };
}

export function calculateNDRDetails(orders: any[]) {
  let totalNDR = 0;
  let yourReattempt = 0;
  let buyerReattempt = 0;
  let NDRDelivered = 0;

  orders.forEach((order) => {
    switch (order.bucket) {
      case (12, 13, 14, 15, 16, 17):
        totalNDR++;
        break;
      case (12, 13, 14):
        yourReattempt++;
        break;
      case (15, 16, 17):
        buyerReattempt++;
        break;
      default:
        break;
    }
  });

  return { TotalNRD: orders.length, buyerReattempt, yourReattempt, NDRDelivered };
}

export function calculateCODDetails(orders: any[]) {
  const currentDate = new Date();
  const date30DaysAgo = new Date(currentDate);
  date30DaysAgo.setDate(date30DaysAgo.getDate() - 30);

  const CODOrders = orders.filter((order) => order.payment_mode === 1);
  const totalCODLast30Days = CODOrders.filter((order) => new Date(order.order_invoice_date) >= date30DaysAgo).length;
  const CODAvailable = CODOrders.length;

  const currentDateTimestamp = currentDate.getTime();
  const eightDaysAgoTimestamp = currentDateTimestamp - 8 * 24 * 60 * 60 * 1000;
  const CODPending = CODOrders.filter(
    (order) => new Date(order.order_invoice_date).getTime() < eightDaysAgoTimestamp
  ).length;

  const remittedCODOrders = CODOrders.filter((order) => order.bucket === 3);
  const lastCODRemitted = remittedCODOrders.reduce(
    (prev, curr) => (new Date(curr.order_invoice_date) > new Date(prev.order_invoice_date) ? curr : prev),
    {}
  );

  return { totalCODLast30Days, CODAvailable, CODPending, lastCODRemitted };
}

export function calculateRevenue(orders: any[]) {
  return orders.reduce((total, order) => total + (order.amount2Collect || 0), 0);
}

export function calculateAverageShippingCost(orders: any[]) {
  const totalShippingCost = orders.reduce((total, order) => total + (order.amount2Collect || 0), 0);
  return orders.length > 0 ? totalShippingCost / orders.length : 0;
}

export async function updateOrderStatus(orderId: Types.ObjectId, stage: number, action: string) {
  try {
    const updatedOrder = await B2COrderModel.findByIdAndUpdate(
      orderId,
      {
        $push: {
          orderStages: {
            stage,
            action,
            stageDateTime: new Date(),
          },
        },
        $set: { bucket: stage },
      },
      { new: true }
    );
    return updatedOrder;
  } catch (err) {
    throw err;
  }
}

export async function sendMail({ user }: { user: { email: string; name: string; forgetPasswordToken: string } }) {
  const forgotPassTemplate = `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">

  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  </head>
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">Lorrigo reset your password</div>

  <body style="background-color:#f6f9fc;padding:10px 0">
    <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:37.5em;background-color:#ffffff;border:1px solid #f0f0f0;padding:45px">
      <tbody>
        <tr style="width:100%">
          <td><img alt="Lorrigo" height="33" width="100" src="https://main.d64yg95zjbugj.amplifyapp.com/_next/image?url=%2Fassets%2Flogogosog.png&w=256&q=75" style="display:block;outline:none;border:none;text-decoration:none" width="40" />
            <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation">
              <tbody>
                <tr>
                  <td>
                    <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">Hi <!-- -->${user.name}<!-- -->,</p>
                    
                    <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">Someone recently requested a password change for your Lorrigo account. If this was you, you can set a new password here:</p>
                    
                    <a href="${user.forgetPasswordToken}" style="background-color:#bf0000;border-radius:4px;color:#fff;font-family:&#x27;Open Sans&#x27;, &#x27;Helvetica Neue&#x27;, Arial;font-size:15px;text-decoration:none;text-align:center;display:inline-block;width:210px;padding:14px 7px 14px 7px;line-height:100%;max-width:100%" target="_blank"><span><!--[if mso]><i style="letter-spacing: 7px;mso-font-width:-100%;mso-text-raise:21" hidden>&nbsp;</i><![endif]--></span><span style="max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;mso-text-raise:10.5px">Reset password</span><span><!--[if mso]><i style="letter-spacing: 7px;mso-font-width:-100%" hidden>&nbsp;</i><![endif]--></span></a>
                   
                    <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">If you don&#x27;t want to change your password or didn&#x27;t request this, just ignore and delete this message.</p>
             
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </body>

</html>
    `;
  let transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: process.env.SMTP_ID,
      pass: process.env.SMTP_PASS,
    },
  });

  let mailOptions = {
    from: `"Lorrigo Logistic" <${process.env.SMTP_ID}>`,
    to: user.email,
    subject: "Reset Password Link for your account | Lorrigo",
    text: "You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n",
    html: forgotPassTemplate,
  };

  try {
    let info = await transporter.sendMail(mailOptions);
    return {
      status: 200,
      message: "Email sent successfully",
    };
  } catch (error: any) {
    console.error("Error occurred:", error.message);
    return {
      status: 500,
      message: "Failed to send email: " + error.message,
    };
  }
}

export function generateRemittanceId(companyName: string, sellerId: string, currentDate: Date) {
  // Extracting relevant components from the current date
  const year = String(currentDate.getFullYear()).slice(-2);
  const month = ("0" + (currentDate.getMonth() + 1)).slice(-2);
  const date = ("0" + currentDate.getDate()).slice(-2);

  // Generating remittance ID
  const remittanceNumber = ("0000" + Math.floor(Math.random() * 10000)).slice(-4);

  // Combining components to form the remittance ID
  const remittanceId = `${companyName.toUpperCase()}${sellerId.slice(-6)}${year}${month}${date}${remittanceNumber}`;

  return remittanceId;
}

export const getFridayDate = (date: Date) => {
  const startOfCurrentWeek = startOfWeek(date, { weekStartsOn: 1 }); // Assuming Monday is the start of the week
  const fridayDate = addDays(startOfCurrentWeek, 5); // Adding 5 days to get to Friday
  return fridayDate;
};

export function csvJSON(csv: any) {
  var lines = csv.split("\n");
  var result = [];
  var headers = lines[0].split(",");

  if (lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  for (var i = 1; i < lines.length; i++) {
    var obj: any = {};
    var currentline = lines[i].split(",");

    for (var j = 0; j < headers.length; j++) {
      obj[headers[j].trim()] = currentline[j]
    }
    result.push(obj);
  }
  return result;
}

export const validateField = (value: any, fieldName: string, hub: any, alreadyExistingHubsName: any): string | null => {
  switch (fieldName) {
    case 'name':
      // if (!value || value.trim().length === 0) {
      //   return 'Name is required';
      // }
      if (alreadyExistingHubsName.find((item: any) => item.name.includes(value))) {
        return "Name must be unique";
      }
      break;
    case "email":
      if (!value || !validateEmail(value)) {
        return "Invalid email format";
      }
      break;
    case "phone":
      if (!value || !(value.toString().slice(2, 12).length === 10)) {
        return "Invalid PickupLocationContact";
      }
      break;
    // Add validation cases for other fields as needed
    default:
      break;
  }
  return null;
};
export const validateBulkOrderField = (value: any, fieldName: string, order: any, alreadyExistingOrders: any): string | null => {
  switch (fieldName) {
    case 'order_reference_id':
      console.log("order_reference_id", fieldName)
      if (alreadyExistingOrders.find((item: any) => item.order_reference_id.includes(value))) {
        console.log("error orcer_ref", alreadyExistingOrders)
        return "order_id / order_reference_id must be unique";
      }
      break;
    // case "email":
    //   if (!value || !validateEmail(value)) {
    //     return "Invalid email format";
    //   }
    //   break;
    // case "phone":
    //   if (!value || !(value.toString().slice(2, 12).length === 10)) {
    //     return "Invalid PickupLocationContact";
    //   }
    //   break;
    // Add validation cases for other fields as needed
    default:
      break;
  }
  return "";
};

export function cleanPhoneNumber(phoneNumber: string) {
  // Remove +91
  let cleanedNumber = phoneNumber.replace(/\+91/, '');
  // Remove all whitespace characters
  cleanedNumber = cleanedNumber.replace(/\s+/g, '');
  return cleanedNumber;
}