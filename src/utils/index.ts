import mongoose, { Types } from "mongoose";
import { B2BOrderModel, B2COrderModel } from "../models/order.model";
import nodemailer from "nodemailer";
import { startOfWeek, addDays, getDay, format, startOfDay } from "date-fns";
import { getDelhiveryToken, getDelhiveryToken10, getDelhiveryTokenPoint5, getSellerChannelConfig, getShiprocketToken, getSMARTRToken, getSmartShipToken, MetroCitys, NorthEastStates, validateEmail } from "./helpers";
import { COURRIER_ASSIGNED_ORDER_DESCRIPTION, DELIVERED, IN_TRANSIT, MANIFEST_ORDER_DESCRIPTION, PICKUP_SCHEDULED_DESCRIPTION, READY_TO_SHIP, RETURN_CONFIRMED, RTO, SHIPMENT_CANCELLED_ORDER_DESCRIPTION, SHIPMENT_CANCELLED_ORDER_STATUS, SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS, SHIPROCKET_MANIFEST_ORDER_STATUS, SMARTSHIP_COURIER_ASSIGNED_ORDER_STATUS, SMARTSHIP_MANIFEST_ORDER_STATUS } from "./lorrigo-bucketing-info";
import { DeliveryDetails, IncrementPrice, PickupDetails, Vendor, Body } from "../types/rate-cal";
import SellerModel from "../models/seller.model";
import CourierModel from "../models/courier.model";
import PaymentTransactionModal from "../models/payment.transaction.modal";
import { rechargeWalletInfo } from "./recharge-wallet-info";
import axios from "axios";
import envConfig from "./config";
import APIs from "./constants/third_party_apis";
import ShipmentResponseModel from "../models/shipment-response.model";


export function calculateShipmentDetails(orders: any[]) {
  let totalShipments: any[] = [];
  let pickupPending = 0;
  let inTransit = 0;
  let delivered = 0;
  let rto = 0;

  orders.forEach((order) => {
    totalShipments.push(order);
    switch (order.bucket) {
      case READY_TO_SHIP:
        pickupPending++;
        break;
      case IN_TRANSIT:
        inTransit++;
        break;
      case DELIVERED:
        delivered++;
        break;
      case RTO:
        rto++;
        break;
      default:
        break;
    }
  });

  return { totalShipments, pickupPending, inTransit, delivered, ndrPending: 0, rto };
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

  return { TotalNRD: 0, buyerReattempt: 0, yourReattempt: 0, NDRDelivered: 0 };
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
    let updatedOrder = await B2COrderModel.findByIdAndUpdate(
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

    // If order not found in B2C, try finding it in the B2B modal
    if (!updatedOrder) {
      updatedOrder = await B2BOrderModel.findByIdAndUpdate(
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
    }

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

export function generateRemittanceId(companyName: string, sellerId: string, currentDate: string) {
  // Extracting relevant components from the current date
  // const year = String(currentDate.getFullYear()).slice(-2);
  // const month = ("0" + (currentDate.getMonth() + 1)).slice(-2);
  // const date = ("0" + currentDate.getDate()).slice(-2);

  // Generating remittance ID
  const remittanceNumber = ("0000" + Math.floor(Math.random() * 10000)).slice(-4);

  // Combining components to form the remittance ID
  const remittanceId = `${companyName.toUpperCase()}${sellerId.slice(-6)}${currentDate.replaceAll("-", "")}${remittanceNumber}`;

  return remittanceId;
}

export const getFridayDate = (date: Date) => {
  const startOfCurrentWeek = startOfWeek(date, { weekStartsOn: 1 }); // Assuming Monday is the start of the week
  const fridayDate = addDays(startOfCurrentWeek, 5); // Adding 5 days to get to Friday
  return fridayDate;
};

export const nextFriday = (currentDate: Date) => {
  const dayOfWeek = currentDate.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7; // 5 represents Friday
  const date = addDays(startOfDay(currentDate), daysUntilFriday);
  const formattedDate = format(date, 'yy-MM-dd'); // Formats date as 'YYYY-MM-DD'
  console.log("Next Friday:", formattedDate);
  return formattedDate;
};

// What is this function doing? 
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
      if (!value || value.trim().length === 0) {
        return 'Name is required';
      }
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
    case 'isRTOAddressSame':
      if (value === false) {
        if (!hub.rtoAddress || hub.rtoAddress.trim().length === 0) {
          return 'RTO Address is required';
        }
        if (!hub.rtoCity || hub.rtoCity.trim().length === 0) {
          return 'RTO City is required';
        }
        if (!hub.rtoState || hub.rtoState.trim().length === 0) {
          return 'RTO State is required';
        }
        if (!hub.rtoPincode || hub.rtoPincode.trim().length === 0) {
          return 'RTO Pincode is required';
        }
      }
      break;
    default:
      break;
  }
  return null;
};
export const validateBulkOrderField = (value: any, fieldName: string, order: any, alreadyExistingOrders: any): string | null => {
  switch (fieldName) {
    case 'order_reference_id':
      if (alreadyExistingOrders.find((item: any) => item.order_reference_id.includes(value))) {
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

export function convertToISO(invoice_date?: string): string {
  let day, month, year, hour = 0, minute = 0, second = 0;

  if (!invoice_date || invoice_date.trim() === '') {
    // If the date is not provided, use the current date and time
    const now = new Date();
    return now.toISOString();
  }

  let datePart, timePart;
  if (invoice_date.includes('-')) {
    // Format: DD-MM-YYYY or DD-MM-YYYY HH:MM:SS
    [datePart, timePart] = invoice_date.split(' ');
    [day, month, year] = datePart.split('-').map(Number);
  } else if (invoice_date.includes('/')) {
    // Format: MM/DD/YYYY or MM/DD/YYYY HH:MM:SS
    [datePart, timePart] = invoice_date.split(' ');
    [month, day, year] = datePart.split('/').map(Number);
  } else {
    throw new Error("Invalid date format");
  }

  if (timePart && !timePart?.includes('00:00')) {
    [hour, minute, second] = timePart.split(':').map(Number);
  } else {
    const now = new Date();
    hour = now.getHours();
    minute = now.getMinutes();
    second = now.getSeconds();
  }

  // Validate the date
  const date = new Date(year, month - 1, day, hour, minute, 0);
  if (isNaN(date.getTime())) {
    throw new Error("Invalid date components");
  }

  return date.toISOString();
}

export function getNextToNextFriday() {
  let currentDate = new Date(); // Get the current date
  let dayOfWeek = getDay(currentDate); // Get the current day of the week (0: Sunday, 1: Monday, ..., 6: Saturday)

  // Calculate the number of days to add to reach next Friday
  let daysToAdd = (dayOfWeek <= 5) ? 5 - dayOfWeek + 7 : 5 - dayOfWeek;

  // Add the days to the current date to get next Friday
  let nextFriday = addDays(currentDate, daysToAdd);

  // Add 7 more days to get the next to next Friday
  let nextToNextFriday = addDays(nextFriday, 7);

  return nextToNextFriday;
}

export const validateClientBillingFeilds = (value: any, fieldName: string, bill: any, alreadyExistingBills: any): string | null => {
  switch (fieldName) {
    case 'orderRefId':
      if (!value || alreadyExistingBills.find((item: any) => item.orderRefId.includes(value))) {
        return "Order ID / Order Reference ID must be unique and cannot be empty";
      }
      break;
    case 'billingDate':
      if (!value) {
        return "Billing date is required";
      }
      break;
    case 'awb':
      if (!value) {
        return "AWB is required";
      }
      break;
    // case 'rtoAwb':
    //   if (!value) {
    //     return "RTO AWB is required";
    //   }
    //   break;
    case 'recipientName':
      if (!value) {
        return "Recipient name is required";
      }
      break;
    case 'shipmentType':
      if (value !== 0 && value !== 1) {
        return "Shipment type is required and must be either 0 or 1";
      }
      break;
    case 'fromCity':
      if (!value) {
        return "Origin city is required";
      }
      break;
    case 'toCity':
      if (!value) {
        return "Destination city is required";
      }
      break;
    case 'chargedWeight':
      if (!value || isNaN(value)) {
        return "Charged weight is required and must be a number";
      }
      break;
    case 'zone':
      if (!value) {
        return "Zone is required";
      }
      break;
    case 'isForwardApplicable':
      if (value === null || value === undefined) {
        return "Forward applicable flag is required";
      }
      break;
    case 'isRTOApplicable':
      if (value === null || value === undefined) {
        return "RTO applicable flag is required";
      }
      break;
    default:
      break;
  }
  return null;
};

export async function sendMailToScheduleShipment({ orders, pickupDate }: { orders: any[], pickupDate: string }) {
  const Template = `
  <!DOCTYPE html
  PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">

<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <style>
      table {
          border-collapse: collapse;
          border: 1px solid black;
          /* Border around the table */
      }
      th,td {
          border: 1px solid black;
          /* Border around each cell */
          padding: 8px;
          /* Adding padding for better readability */
      }
  </style>
</head>
<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">
</div>
<body style="margin: 0 auto;max-width:50.5em;background-color:#f6f9fc;padding:10px 0">
  <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation"
      style="background-color:#ffffff;padding:45px">
          <p
              style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">
              Hi Please arrange the pickups for following orders.
          </p>
          <table>
              <thead>
                  <tr>
                      <th>Awb</th>
                      <th>Date Of Pickup</th>
                      <th>No. Boxes</th>
                      <th>Total Weight(kgs)</th>
                      <th>Pickup Address</th>
                  </tr>
              </thead>
              <tbody>
                  ${orders?.map((order) => {
    return `
                      <tr>
                          <td>${order?.awb}</td>
                          <td>${format(pickupDate?.replaceAll(" ", "-"), "dd/MM/yyyy")}</td>
                          <td>${order?.productId?.quantity || order.quantity}</td>
                          <td>${order?.orderWeight || order?.total_weight}</td>
                          <td>${order?.pickupAddress?.address1}</td>
                      </tr>
                      `;
  })
    }
              </tbody>
          </table>
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
    to: "naveenp@smartr.in",
    subject: "Rescheduled orders | Lorrigo",
    text: "Please arrange the pickups for following orders.",
    html: Template,
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

export async function calculateShippingCharges(
  pickupDetails: PickupDetails,
  deliveryDetails: DeliveryDetails,
  body: Body,
  vendor: any
): Promise<{
  totalCharge: number;
  incrementPrice: IncrementPrice;
  orderWeight: number;
}> {
  const orderWeight = body.weight

  const increment_price = getIncrementPrice(pickupDetails, deliveryDetails, MetroCitys, NorthEastStates, vendor);
  console.log(increment_price)
  if (!increment_price) {
    throw new Error("Invalid increment price");
  }

  const totalCharge = calculateTotalCharge(orderWeight, increment_price, body, vendor);
  return {
    totalCharge,
    incrementPrice: increment_price,
    orderWeight,
  };
}

function getIncrementPrice(
  pickupDetails: PickupDetails,
  deliveryDetails: DeliveryDetails,
  MetroCitys: string[],
  NorthEastStates: string[],
  vendor: any
): IncrementPrice | null {
  if (pickupDetails.District === deliveryDetails.District) {
    return vendor.withinCity;
  } else if (pickupDetails.StateName === deliveryDetails.StateName) {
    return vendor.withinZone;
  } else if (MetroCitys.includes(pickupDetails.District) && MetroCitys.includes(deliveryDetails.District)) {
    return vendor.withinMetro;
  } else if (NorthEastStates.includes(pickupDetails.StateName) || NorthEastStates.includes(deliveryDetails.StateName)) {
    return vendor?.northEast;
  } else {
    return vendor?.withinRoi;
  }
}

function calculateTotalCharge(
  orderWeight: number,
  incrementPrice: IncrementPrice,
  body: Body,
  vendor: Vendor
): number {
  let totalCharge = incrementPrice.basePrice;
  const adjustedOrderWeight = orderWeight - vendor.weightSlab;
  const weightIncrementRatio = Math.ceil(adjustedOrderWeight / vendor.incrementWeight);
  totalCharge += incrementPrice.incrementPrice * weightIncrementRatio;

  if (body.paymentType === 1) {
    const codPrice = vendor.codCharge?.hard || 0;
    const codAfterPercent = (vendor.codCharge?.percent ?? 0 / 100) * body.collectableAmount;
    totalCharge += Math.max(codPrice, codAfterPercent);
  }

  return totalCharge;
}

export async function updateSellerWalletBalance(sellerId: string, amount: number, isCredit: boolean, desc: string) {
  // Validate amount
  if (typeof amount !== 'number' || isNaN(amount)) {
    throw new Error('Invalid amount');
  }

  const update = {
    $inc: {
      walletBalance: isCredit ? amount : -amount,
    },
  };

  const merchantTransactionId = `LS${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    // Update seller's wallet balance atomically
    const updatedSeller = await SellerModel.findOneAndUpdate(
      { _id: sellerId.toString() },
      update,
      { new: true }
    );

    if (!updatedSeller) {
      throw new Error('Seller not found');
    }

    // Create payment transaction
    await PaymentTransactionModal.create(
      {
        sellerId: sellerId.toString(),
        amount,
        merchantTransactionId,
        code: isCredit ? 'CREDIT' : 'DEBIT',
        desc,
        stage: [{
          action: 'PAYMENT_SUCCESSFUL',
          dateTime: new Date().toISOString()
        }]
      }
    );

    return updatedSeller;
  } catch (err: any) {
    console.error('Error updating seller wallet balance:', err);
    throw new Error('Failed to update seller wallet balance');
  }
}

export async function shipmentAmtCalcToWalletDeduction(awb: string) {
  try {
    const order: any = await B2COrderModel
      .findOne({ awb })
      .populate('pickupAddress')

    if (!order) {
      throw new Error('Order not found');
    }

    // const courier = await CourierModel.findOne({
    //   name: {
    //     $regex: new RegExp(order.carrierName.split(' ').slice(0, 2).join(' ') + '[ -](SS|\\d+\\.\\d+kg|SR|express|.*)?', 'i')
    //   }
    // });

    let regexPattern = order.carrierName.split(' ').slice(0, 3).join(' ') + '(\\s+(SS|SR|SMR|DEL(_\\d+(\\.\\d+)?|)|.*)?)?';
    let courier = await CourierModel.findOne({
      name: {
        $regex: new RegExp(regexPattern, 'i')
      }
    });
    console.log("\n\n");
    console.log(order.carrierName, order.carrierName.split(' ').slice(0, 3), "order.carrierName")

    if (!courier) {
      regexPattern = order.carrierName.split(' ').slice(0, 3).join(' ') + '(\\s+SR)?';
      courier = await CourierModel.findOne({
        name: {
          $regex: new RegExp(regexPattern, 'i')
        }
      });
    }

    // Bluedart surface 0.5kg SR [ 'Bluedart', 'surface', '0.5kg' ] order.carrierName
    if (!courier) {
      throw new Error('Courier not found');
    }

    console.log("courier found RTO")

    const pickupDetails = {
      StateName: order.pickupAddress.state,
      District: order.pickupAddress.city
    }

    const deliveryDetails = {
      StateName: order.customerDetails.get("state"),
      District: order.customerDetails.get("city")
    }

    const increment_price = getIncrementPrice(pickupDetails, deliveryDetails, MetroCitys, NorthEastStates, courier);
    if (!increment_price) {
      throw new Error("Invalid increment price");
    }

    const minWeight = courier.weightSlab;
    //@ts-ignore
    let totalCharge = 0;
    totalCharge += increment_price.basePrice;

    let orderWeight = order.orderWeight;
    if (orderWeight < minWeight) {
      orderWeight = minWeight;
    }

    const codPrice = courier.codCharge?.hard;
    const codAfterPercent = (courier.codCharge?.percent / 100) * order.amount2Collect;
    let cod = 0;
    if (order.paymentType === 1) {
      cod = codPrice > codAfterPercent ? codPrice : codAfterPercent;
    }

    const weightIncrementRatio = Math.ceil((order.orderWeight - minWeight) / courier.incrementWeight);
    totalCharge += (increment_price.incrementPrice * weightIncrementRatio) + cod;
    let rtoCharges = (totalCharge - cod)


    return { rtoCharges, cod };

  } catch (error) {
    console.log(error)
  }
}

export async function handleSmartShipShipment(
  { productDetails, sellerId, sellerGST, hubDetails, carrierId, order, charge, vendorName }:
    { productDetails: any, sellerId: string, sellerGST: string, hubDetails: any, carrierId: string, order: any, charge: number, vendorName: any }) {
  const smartShipCourier = await CourierModel.findById(carrierId);
  const productValueWithTax =
    Number(productDetails.taxable_value) +
    (Number(productDetails.tax_rate) / 100) * Number(productDetails.taxable_value);

  const totalOrderValue = productValueWithTax * Number(productDetails.quantity);

  const isReshipedOrder =
    order.orderStages.find((stage: any) => stage.stage === SHIPMENT_CANCELLED_ORDER_STATUS)?.action ===
    SHIPMENT_CANCELLED_ORDER_DESCRIPTION;

  let lastNumber = order?.client_order_reference_id?.match(/\d+$/)?.[0] || "";

  let incrementedNumber = lastNumber ? (parseInt(lastNumber) + 1).toString() : "1";

  let newString = `${order?.client_order_reference_id?.replace(/\d+$/, "")}_R${incrementedNumber}`;

  const client_order_reference_id = isReshipedOrder ? newString : `${order?.order_reference_id}`;

  let orderWeight = order?.orderWeight * 1000;

  const shipmentAPIBody = {
    request_info: {
      run_type: "create",
      shipment_type: order.isReverseOrder ? 2 : 1, // 1 => forward, 2 => return order
    },
    orders: [
      {
        "client_order_reference_id": client_order_reference_id,
        "shipment_type": order.isReverseOrder ? 2 : 1,
        "order_collectable_amount": order.payment_mode === 1 ? order.amount2Collect : 0, // need to take  from user in future,
        "total_order_value": totalOrderValue,
        "payment_type": order.payment_mode ? "cod" : "prepaid",
        "package_order_weight": orderWeight,
        "package_order_length": order.orderBoxLength,
        "package_order_height": order.orderBoxWidth,
        "package_order_width": order.orderBoxHeight,
        "shipper_hub_id": hubDetails.hub_id,
        "shipper_gst_no": sellerGST,
        "order_invoice_date": order?.order_invoice_date,
        "order_invoice_number": order?.order_invoice_number || "Non-commercial",
        // "is_return_qc": "1",
        // "return_reason_id": "0",
        order_meta: {
          preferred_carriers: [carrierId],
        },
        product_details: [
          {
            client_product_reference_id: "something",
            product_name: productDetails?.name,
            product_category: productDetails?.category,
            product_hsn_code: productDetails?.hsn_code || "0000",
            product_quantity: productDetails?.quantity,
            product_invoice_value: 11234,
            product_gst_tax_rate: productDetails.tax_rate,
            product_taxable_value: productDetails.taxable_value,
            // "product_sgst_amount": "2",
            // "product_sgst_tax_rate": "2",
            // "product_cgst_amount": "2",
            // "product_cgst_tax_rate": "2"
          },
        ],
        consignee_details: {
          consignee_name: order.customerDetails.get("name"),
          consignee_phone: order.customerDetails?.get("phone"),
          consignee_email: order.customerDetails.get("email"),
          consignee_complete_address: order.customerDetails.get("address"),
          consignee_pincode: order.customerDetails.get("pincode"),
        },
      },
    ],
  };

  let smartshipToken;
  smartshipToken = await getSmartShipToken();
  if (!smartshipToken) throw new Error("Invalid token");

  let externalAPIResponse: any;
  try {
    const requestConfig = { headers: { Authorization: smartshipToken } };
    const response = await axios.post(
      envConfig.SMART_SHIP_API_BASEURL + APIs.CREATE_SHIPMENT,
      shipmentAPIBody,
      requestConfig
    );
    externalAPIResponse = response.data;
  } catch (err: unknown) {
    console.log(err, "error[smartship]")
  }

  if (externalAPIResponse?.status === "403") {
    throw new Error("Smartship ENVs is expired.");
  }
  if (!externalAPIResponse?.data?.total_success_orders) {
    throw new Error("Courier Not Serviceable!")
  } else {
    const shipmentResponseToSave = new ShipmentResponseModel({ order: order._id, response: externalAPIResponse });
    try {
      const savedShipmentResponse = await shipmentResponseToSave.save();
      const awbNumber = externalAPIResponse?.data?.success_order_details?.orders[0]?.awb_number;
      console.log("[SmartShip createShipment controller] awbNumber", externalAPIResponse?.data?.success_order_details?.orders[0]);
      if (!awbNumber) {
        throw new Error("Please choose another courier partner!")
      }
      const carrierName = smartShipCourier?.name + " " + vendorName?.nickName;
      order.client_order_reference_id = client_order_reference_id;
      order.shipmentCharges = charge;
      order.bucket = order.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;
      order.orderStages.push({
        stage: SMARTSHIP_COURIER_ASSIGNED_ORDER_STATUS,
        action: COURRIER_ASSIGNED_ORDER_DESCRIPTION,
        stageDateTime: new Date(),
      });
      order.awb = awbNumber;
      order.carrierName = carrierName;
      const updatedOrder = await order.save();

      if (order.channelName === "shopify") {
        try {
          const shopfiyConfig = await getSellerChannelConfig(sellerId);
          const shopifyOrders = await axios.get(
            `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT_ORDER}/${order.channelOrderId}/fulfillment_orders.json`,
            {
              headers: {
                "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
              },
            }
          );

          const fulfillmentOrderId = shopifyOrders?.data?.fulfillment_orders[0]?.id;

          const shopifyFulfillment = {
            fulfillment: {
              line_items_by_fulfillment_order: [
                {
                  fulfillment_order_id: fulfillmentOrderId,
                },
              ],
              tracking_info: {
                company: carrierName,
                number: awbNumber,
                url: `https://lorrigo.in/track/${order?._id}`,
              },
            },
          };

          const shopifyFulfillmentResponse = await axios.post(
            `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT}`,
            shopifyFulfillment,
            {
              headers: {
                "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
              },
            }
          );

          order.channelFulfillmentId = fulfillmentOrderId;
          await order.save();
        } catch (error) {
          console.log("Error[shopify]", error);
        }
      }

      await updateSellerWalletBalance(sellerId, Number(charge), false, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);

      return savedShipmentResponse;
    } catch (err) {
      console.log(err, "error[smartship shipment]")
    }
  }
}

export async function registerOrderOnShiprocket(orderDetails: any, customClientRefOrderId: any) {
  try {
    let shiprocketOrder;
    const shiprocketToken = await getShiprocketToken();
    if (!shiprocketToken) return "Invalid token"

    const orderPayload = {
      order_id: customClientRefOrderId,
      order_date: format(orderDetails?.order_invoice_date, 'yyyy-MM-dd HH:mm'),
      pickup_location: orderDetails?.pickupAddress?.name,
      billing_customer_name: orderDetails?.customerDetails.get("name"),
      billing_last_name: orderDetails?.customerDetails.get("name") || "",
      billing_address: orderDetails?.customerDetails.get("address"),
      billing_city: orderDetails?.customerDetails.get("city"),
      billing_pincode: orderDetails?.customerDetails.get("pincode"),
      billing_state: orderDetails?.customerDetails.get("state"),
      billing_country: "India",
      billing_email: orderDetails?.customerDetails.get("email") || "noreply@lorrigo.com",
      billing_phone: orderDetails?.customerDetails.get("phone").toString().replaceAll(' ', '').slice(3, 13),
      order_items: [
        {
          name: orderDetails.productId.name,
          sku: orderDetails.productId.category.slice(0, 40),
          units: 1,
          selling_price: Number(orderDetails.productId.taxable_value),
        }
      ],
      payment_method: orderDetails?.payment_mode === 0 ? "Prepaid" : "COD",
      sub_total: Number(orderDetails.productId?.taxable_value),
      length: orderDetails.orderBoxLength,
      breadth: orderDetails.orderBoxWidth,
      height: orderDetails.orderBoxHeight,
      // weight: 0.5,
      // if Weight is less than 5, then set it to 0.5, else set it to orderWeight
      // weight: orderDetails.orderWeight >= 5 ? orderDetails.orderWeight : 0.5,
      weight: orderDetails.orderWeight,
    };

    if (orderDetails?.isReverseOrder) {
      Object.assign(orderPayload, {
        pickup_customer_name: orderDetails?.customerDetails?.get("name"),
        pickup_phone: orderDetails?.customerDetails?.get("phone").toString().slice(3, 13),
        pickup_address: orderDetails?.customerDetails?.get("address"),
        pickup_pincode: orderDetails?.customerDetails?.get("pincode"),
        pickup_city: orderDetails?.customerDetails?.get("city"),
        pickup_state: orderDetails?.customerDetails?.get("state"),
        pickup_country: "India",
        shipping_customer_name: orderDetails?.pickupAddress?.name,
        shipping_country: "India",
        shipping_address: orderDetails?.pickupAddress?.address1,
        shipping_pincode: orderDetails?.pickupAddress?.pincode,
        shipping_city: orderDetails?.pickupAddress?.city,
        shipping_state: orderDetails?.pickupAddress?.state,
        shipping_phone: orderDetails?.pickupAddress?.phone.toString().slice(3, 13)
      });
    } else {
      Object.assign(orderPayload, {
        shipping_is_billing: true,
        shipping_customer_name: orderDetails?.sellerDetails.get("sellerName") || "",
        shipping_last_name: orderDetails?.sellerDetails.get("sellerName") || "",
        shipping_address: orderDetails?.sellerDetails.get("sellerAddress"),
        shipping_address_2: "",
        shipping_city: orderDetails?.sellerDetails.get("sellerCity"),
        shipping_pincode: orderDetails?.sellerDetails.get("sellerPincode"),
        shipping_country: "India",
        shipping_state: orderDetails?.sellerDetails.get("sellerState"),
        shipping_phone: orderDetails?.sellerDetails.get("sellerPhone"),
        ewaybill_no: orderDetails?.ewaybill,
      });
    }

    const shiprocketAPI = orderDetails.isReverseOrder ? APIs.CREATE_SHIPROCKET_RETURN_ORDER : APIs.CREATE_SHIPROCKET_ORDER;

    try {
      if (!orderDetails.shiprocket_order_id) {
        shiprocketOrder = await axios.post(envConfig.SHIPROCKET_API_BASEURL + shiprocketAPI, orderPayload, {
          headers: {
            Authorization: shiprocketToken,
          },
        });
        orderDetails.shiprocket_order_id = shiprocketOrder.data.order_id;
        orderDetails.shiprocket_shipment_id = shiprocketOrder.data.shipment_id;
        orderDetails.client_order_reference_id = customClientRefOrderId;
        await orderDetails.save();
      }
    } catch (error: any) {
      console.log("error", error.response.data.errors);
    }

    const shiprocketOrderID = orderDetails?.shiprocket_order_id ?? 0;
    return shiprocketOrderID;
  } catch (error) {
    console.log(error)
  }
}

export async function shiprocketShipment({ sellerId, carrierId, order, charge, vendorName }: { sellerId: string, carrierId: string, order: any, charge: number, vendorName: any }) {
  try {
    const shiprocketCourier = await CourierModel.findById(carrierId)

    const shiprocketToken = await getShiprocketToken();

    const genAWBPayload = {
      shipment_id: order.shiprocket_shipment_id,
      courier_id: carrierId.toString(),
      is_return: order.isReverseOrder ? 1 : 0,
    }
    try {
      const awbResponse = await axios.post(
        envConfig.SHIPROCKET_API_BASEURL + APIs.GENRATE_AWB_SHIPROCKET,
        genAWBPayload,
        {
          headers: {
            Authorization: shiprocketToken,
          },
        }
      );

      let awb = awbResponse?.data?.response?.data?.awb_code || awbResponse?.data?.response?.data?.awb_assign_error?.split("-")[1].split(" ")[1];

      if (!awb) {
        return { valid: false, message: "Internal Server Error, Please use another courier partner" };
      }

      order.awb = awb;
      order.carrierName = (shiprocketCourier?.name) + " " + (vendorName?.nickName);
      order.shipmentCharges = charge;
      order.bucket = order?.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;
      order.orderStages.push({
        stage: SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS,
        action: COURRIER_ASSIGNED_ORDER_DESCRIPTION,
        stageDateTime: new Date(),
      });

      await order.save();

      let fulfillmentOrderId: string = "";
      try {
        if (order.channelName === "shopify") {
          const shopfiyConfig = await getSellerChannelConfig(sellerId);
          const shopifyOrders = await axios.get(
            `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT_ORDER}/${order.channelOrderId}/fulfillment_orders.json`,
            {
              headers: {
                "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
              },
            }
          );

          fulfillmentOrderId = shopifyOrders?.data?.fulfillment_orders[0]?.id;

          const shopifyFulfillment = {
            fulfillment: {
              line_items_by_fulfillment_order: [
                {
                  fulfillment_order_id: fulfillmentOrderId,
                },
              ],
              tracking_info: {
                company: awbResponse?.data?.response?.data?.awb_code,
                number: awbResponse?.data?.response?.data.courier_name + " " + vendorName?.nickName,
                url: `https://lorrigo.in/track/${order?._id}`,
              },
            },
          };
          const shopifyFulfillmentResponse = await axios.post(
            `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT}`,
            shopifyFulfillment,
            {
              headers: {
                "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
              },
            }
          );
        }
      } catch (error: any) {
        console.log("Error[shopify]", error?.response?.data?.errors);
      }

      order.channelFulfillmentId = fulfillmentOrderId;
      await order.save();
      await updateSellerWalletBalance(sellerId, Number(charge), false, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
      return order
    } catch (error: any) {
      console.log(error, "error");
      throw new Error(error);
    }
  } catch (error: any) {
    console.log(error, "error");
    throw new Error(error);
  }
}

export async function smartRShipment(
  { sellerId, sellerGST, carrierId, order, charge, vendorName, productDetails, hubDetails, courier }:
    { sellerId: string, sellerGST: string, carrierId: string, order: any, charge: number, vendorName: any, productDetails: any, hubDetails: any, courier: any }
) {
  const smartrToken = await getSMARTRToken();
  // if (!smartrToken) throw new Error("Invalid token" );

  const smartrShipmentPayload = [{
    packageDetails: {
      awbNumber: "",
      orderNumber: order.client_order_reference_id,
      productType: order.payment_mode ? "ACC" : "ACP",
      collectableValue: order.payment_mode ? order.amount2Collect : 0,
      declaredValue: productDetails.taxable_value,
      itemDesc: productDetails.name,
      dimensions: `${order.orderBoxLength}~${order.orderBoxWidth}~${order.orderBoxHeight}~${productDetails.quantity}~${order.orderWeight}~0 /`, // LBH-No. of pieces~Weight~0/
      pieces: productDetails.quantity,
      weight: order.orderWeight,
      invoiceNumber: order.order_invoice_number,
    },
    deliveryDetails: {
      toName: order.customerDetails.get("name"),
      toAdd: order.customerDetails.get("address"),
      toCity: order.customerDetails.get("city"),
      toState: order.customerDetails.get("state"),
      toPin: order.customerDetails.get("pincode"),
      // @ts-ignore
      toMobile: order.customerDetails.get("phone").toString().toString().replaceAll(' ', '').slice(3, 13),
      toEmail: order.customerDetails.get("email") || "noreply@lorrigo.com",
      toAddType: "Home", // Mendatory 
      toLat: order.customerDetails.get("lat") || "",
      toLng: order.customerDetails.get("lng") || "",
    },
    pickupDetails: {
      fromName: hubDetails.name,
      fromAdd: hubDetails.address1,
      fromCity: hubDetails.city,
      fromState: hubDetails.state,
      fromPin: hubDetails.pincode,
      fromMobile: hubDetails.phone.toString().slice(-10),
      fromEmail: "",
      fromLat: "",
      fromLng: "",
      fromAddType: "Seller", // Mendatory
    },
    returnDetails: {
      rtoName: hubDetails.name,
      rtoAdd: hubDetails.rtoAddress || hubDetails.address1, // Mendatory
      rtoCity: hubDetails.rtoCity || hubDetails.city, // Mendatory
      rtoState: hubDetails.rtoState || hubDetails.state, // Mendatory
      rtoPin: hubDetails.rtoPincode || hubDetails.pincode, // Mendatory
      rtoMobile: hubDetails.phone.toString().slice(-10),
      rtoEmail: "",
      rtoAddType: "Seller", // Mendatory
      rtoLat: "",
      rtoLng: "",
    },
    additionalInformation: {
      customerCode: "DELLORRIGO001",
      essentialFlag: "",
      otpFlag: "",
      dgFlag: "",
      isSurface: true,
      isReverse: false,
      sellerGSTIN: sellerGST || "", // Mendatory
      sellerERN: "",
    },
  }];

  try {
    let config = {
      method: "post",
      maxBodyLength: Infinity,
      url: "https://api.smartr.in/api/v1/add-order/",
      headers: {
        'Authorization': smartrToken,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify(smartrShipmentPayload),
    };

    const axisoRes = await axios.request(config);
    const smartRShipmentResponse = axisoRes.data;


    let orderAWB = smartRShipmentResponse.total_success[0]?.awbNumber;
    if (orderAWB === undefined) {
      orderAWB = smartRShipmentResponse.total_failure[0]?.awbNumber
    }
    order.awb = orderAWB;
    order.shipmentCharges = charge;
    order.carrierName = courier?.name + " " + (vendorName?.nickName);


    if (orderAWB) {
      order.bucket = order?.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;
      order.orderStages.push({
        stage: SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS,  // Evantuallly change this to SMARTRd_COURIER_ASSIGNED_ORDER_STATUS
        action: COURRIER_ASSIGNED_ORDER_DESCRIPTION,
        stageDateTime: new Date(),
      });

      try {
        if (order.channelName === "shopify") {
          const shopfiyConfig = await getSellerChannelConfig(sellerId);
          const shopifyOrders = await axios.get(
            `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT_ORDER}/${order.channelOrderId}/fulfillment_orders.json`,
            {
              headers: {
                "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
              },
            }
          );

          const fulfillmentOrderId = shopifyOrders?.data?.fulfillment_orders[0]?.id;

          const shopifyFulfillment = {
            fulfillment: {
              line_items_by_fulfillment_order: [
                {
                  fulfillment_order_id: fulfillmentOrderId,
                },
              ],
              tracking_info: {
                company: orderAWB,
                number: courier?.name + " " + (vendorName?.nickName),
                url: `https://lorrigo.in/track/${order?._id}`,
              },
            },
          };
          const shopifyFulfillmentResponse = await axios.post(
            `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT}`,
            shopifyFulfillment,
            {
              headers: {
                "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
              },
            }
          );
          order.channelFulfillmentId = fulfillmentOrderId;
        }
      } catch (error: any) {
        console.log("Error[shopify]", error?.response?.data?.errors);
      }

      await order.save();

      await updateSellerWalletBalance(sellerId, Number(charge), false, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
      return order;
    }
    throw new Error("Please choose another courier partner!");

  } catch (error: any) {
    console.error("Error creating SMARTR shipment:", error);
    throw new Error(error);
  }
}

export async function createDelhiveryShipment(
  { vendorName, order, sellerGST, hubDetails, productDetails, courier, body, sellerId }:
    { vendorName: any, order: any, sellerGST: string, hubDetails: any, productDetails: any, courier: any, body: any, sellerId: any }
) {
  const getDelhiveryTkn = async (type: any) => {
    switch (type) {
      case "DELHIVERY":
        return await getDelhiveryToken();
      case "DELHIVERY_0.5":
        return await getDelhiveryTokenPoint5();
      case "DELHIVERY_10":
        return await getDelhiveryToken10();
      default:
        return null;
    }
  };

  const generatePayload = (order: any, hubDetails: any, productDetails: any, sellerGST: any) => ({
    format: "json",
    data: {
      shipments: [
        {
          name: order.customerDetails.get("name"),
          add: order.customerDetails.get("address"),
          pin: order.customerDetails.get("pincode"),
          city: order.customerDetails.get("city"),
          state: order.customerDetails.get("state"),
          country: "India",
          phone: order.customerDetails.get("phone"),
          order: order.client_order_reference_id,
          payment_mode: order?.isReverseOrder ? "Pickup" : order.payment_mode ? "COD" : "Prepaid",
          return_pin: hubDetails.rtoPincode,
          return_city: hubDetails.rtoCity,
          return_phone: hubDetails.phone,
          return_add: hubDetails.rtoAddress || hubDetails.address1,
          return_state: hubDetails.rtoState || hubDetails.state,
          return_country: "India",
          products_desc: productDetails.name,
          hsn_code: productDetails.hsn_code,
          cod_amount: order.payment_mode ? order.amount2Collect : 0,
          order_date: order.order_invoice_date,
          total_amount: productDetails.taxable_value,
          seller_add: hubDetails.address1,
          seller_name: hubDetails.name,
          seller_inv: order.order_invoice_number,
          quantity: productDetails.quantity,
          waybill: order.ewaybill || "",
          shipment_length: order.orderBoxLength,
          shipment_width: order.orderBoxWidth,
          shipment_height: order.orderBoxHeight,
          weight: order.orderWeight * 1000, // convert to grams
          seller_gst_tin: sellerGST,
          shipping_mode: "Surface",
          address_type: "home",
        },
      ],
      pickup_location: {
        name: hubDetails.name,
        add: hubDetails.address1,
        city: hubDetails.city,
        pin_code: hubDetails.pincode,
        country: "India",
        phone: hubDetails.phone,
      },
    },
  });

  const createOrder = async (vendorName: string, payload: any, delhiveryToken: string) => {
    const urlEncodedPayload = `format=json&data=${encodeURIComponent(JSON.stringify(payload.data))}`;
    return await axios.post(`${envConfig.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_CREATE_ORDER}`, urlEncodedPayload, {
      headers: {
        Authorization: delhiveryToken,
      },
    });
  };

  const updateOrderStages = (order: any) => {
    order.orderStages.push(
      {
        stage: SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS, // Eventually change this to DELHIVERY_COURIER_ASSIGNED_ORDER_STATUS
        action: COURRIER_ASSIGNED_ORDER_DESCRIPTION, // Eventually change this to DELHIVERY_COURIER_ASSIGNED_ORDER_DESCRIPTION
        stageDateTime: new Date(),
      },
      {
        stage: SMARTSHIP_MANIFEST_ORDER_STATUS,
        action: MANIFEST_ORDER_DESCRIPTION,
        stageDateTime: new Date(),
      },
      {
        stage: SHIPROCKET_MANIFEST_ORDER_STATUS,
        action: PICKUP_SCHEDULED_DESCRIPTION,
        stageDateTime: new Date(),
      }
    );
  };

  const handleShopifyFulfillment = async (order: any, delhiveryRes: any, sellerId: string) => {
    try {
      const shopfiyConfig = await getSellerChannelConfig(sellerId);
      const shopifyOrders = await axios.get(
        `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT_ORDER}/${order.channelOrderId}/fulfillment_orders.json`,
        {
          headers: {
            "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
          },
        }
      );

      const fulfillmentOrderId = shopifyOrders?.data?.fulfillment_orders[0]?.id;

      const shopifyFulfillment = {
        fulfillment: {
          line_items_by_fulfillment_order: [
            {
              fulfillment_order_id: fulfillmentOrderId,
            },
          ],
          tracking_info: {
            company: delhiveryRes?.waybill,
            number: courier?.name + " " + (vendorName?.nickName),
            url: `https://lorrigo.in/track/${order?._id}`,
          },
        },
      };
      await axios.post(
        `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT}`,
        shopifyFulfillment,
        {
          headers: {
            "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
          },
        }
      );
      order.channelFulfillmentId = fulfillmentOrderId;
    } catch (error) {
      console.log("Error[shopify]", error);
    }
  };

  const delhiveryProcess = async (vendorType: string, courier: any) => {
    const delhiveryToken = await getDelhiveryTkn(vendorType);
    if (!delhiveryToken) throw new Error("Invalid token");

    const payload = generatePayload(order, hubDetails, productDetails, sellerGST);
    try {
      const response = await createOrder(vendorType, payload, delhiveryToken);
      const delhiveryShipmentResponse = response.data;
      const delhiveryRes = delhiveryShipmentResponse?.packages[0];

      if (!delhiveryRes?.status) {
        throw new Error("Must Select the Delhivery Registered Hub");
      }

      order.awb = delhiveryRes?.waybill;
      order.carrierName = courier?.name + " " + (vendorName?.nickName);
      order.shipmentCharges = body.charge;
      order.bucket = order?.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;

      updateOrderStages(order);

      if (order.channelName === "shopify") {
        try {
          await handleShopifyFulfillment(order, delhiveryRes, sellerId);
        } catch (error) {
          console.log("Error[shopify]", error);
        }
      }

      await order.save();
      await updateSellerWalletBalance(sellerId, Number(body.charge), false, `AWB: ${delhiveryRes?.waybill}, ${order.payment_mode ? "COD" : "Prepaid"}`);
      return order
    } catch (error: any) {
      console.error("Error creating Delhivery shipment:", error);
      throw new Error(error);
    }
  };

  if (["DELHIVERY", "DELHIVERY_0.5", "DELHIVERY_10"].includes(vendorName?.name)) {
    return await delhiveryProcess(vendorName.name, courier);
  }
}