import mongoose, { Types } from "mongoose";
import { B2BOrderModel, B2COrderModel } from "../models/order.model";
import nodemailer from "nodemailer";
import { startOfWeek, addDays, getDay, format, startOfDay } from "date-fns";
import { MetroCitys, NorthEastStates, validateEmail } from "./helpers";
import { DELIVERED, IN_TRANSIT, READY_TO_SHIP, RTO } from "./lorrigo-bucketing-info";
import { DeliveryDetails, IncrementPrice, PickupDetails, Vendor, Body } from "../types/rate-cal";
import SellerModel from "../models/seller.model";
import CourierModel from "../models/courier.model";
import PaymentTransactionModal from "../models/payment.transaction.modal";


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

  if (timePart) {
    [hour, minute, second] = timePart.split(':').map(Number);
  } else {
    const now = new Date();
    hour = now.getHours();
    minute = now.getMinutes();
    second = now.getSeconds();
  }

  // Validate the date
  const date = new Date(year, month - 1, day, hour, minute, second);
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
    case 'rtoAwb':
      if (!value) {
        return "RTO AWB is required";
      }
      break;
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
                  ${orders.map((order) => {
    return `
                      <tr>
                          <td>${order.awb}</td>
                          <td>${format(pickupDate.replaceAll(" ", "-"), "dd/MM/yyyy")}</td>
                          <td>${order.productId.quantity}</td>
                          <td>${order.orderWeight}</td>
                          <td>${order.pickupAddress.address1}</td>
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
    return vendor.northEast;
  } else {
    return vendor.withinRoi;
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

export async function updateSellerWalletBalance(sellerId: string, amount: number, isCredit: boolean) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new Error('Invalid amount');
    }
    console.log(amount, 'amount')
    const update = {
      $inc: {
        walletBalance: isCredit ? amount : -amount,
      },
    };

    const updatedSeller = await SellerModel.findByIdAndUpdate(
      sellerId.toString(),
      update,
      { new: true, session }
    );

    const updatedTxn = await PaymentTransactionModal.create({ 
      sellerId: sellerId,
      amount: amount,
      isCredit: isCredit,
      transactionDate: new Date(),
    }, { session });

    await session.commitTransaction();
    session.endSession();

    if (!updatedSeller) {
      throw new Error('Seller not found');
    }

    return updatedSeller;
  } catch (err) {
    console.log(err, 'error');
    
    await session.abortTransaction();
    session.endSession();
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


    console.log(order.carrierName, order.carrierName.split(' ').slice(0, 3), "order.carrierName")
    let regexPattern = order.carrierName.split(' ').slice(0, 3).join(' ') + '[ -](SS|SR|SMR|DEL(_\\d+(\\.\\d+)?|)|.*)?';
    let courier = await CourierModel.findOne({
      name: {
        $regex: new RegExp(regexPattern, 'i')
      }
    });

    console.log("\n\n")

    if (!courier) {
      regexPattern = order.carrierName.split(' ').slice(0, 3).join(' ') + '/(SR)/g';
      courier = await CourierModel.findOne({
        name: {
          $regex: new RegExp(regexPattern, 'i')
        }
      });
    }

    if (!courier) {
      throw new Error('Courier not found');
    }

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