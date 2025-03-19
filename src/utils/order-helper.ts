import exceljs from "exceljs";
import { Response } from "express";

export function validateOrder(order: any, existingOrderRefs: Set<string>): string[] {
  const errors: string[] = [];
  
  // Check for duplicate order reference ID
  if (existingOrderRefs.has(order.order_reference_id)) {
    errors.push(`Order reference ID '${order.order_reference_id}' already exists`);
  }
  
  // Check required fields
  if (!order.order_reference_id) errors.push("Missing order reference ID");
  
  // Validate product details
  const productDetails = order.productDetails;
  if (!productDetails.name) errors.push("Missing product name");
  if (!productDetails.category) errors.push("Missing product category");
  if (!productDetails.quantity || isNaN(productDetails.quantity)) 
    errors.push("Invalid product quantity");
  if (!productDetails.taxRate || isNaN(productDetails.taxRate)) 
    errors.push("Invalid tax rate");
  if (!productDetails.taxableValue || isNaN(productDetails.taxableValue)) 
    errors.push("Invalid taxable value");
  
  // Validate customer details
  const customerDetails = order.customerDetails;
  if (!customerDetails.name) errors.push("Missing customer name");
  if (!customerDetails.phone || !customerDetails.phone.match(/^\+91\d{10}$/)) 
    errors.push("Invalid customer phone (must be 10 digits with +91 prefix)");
  if (!customerDetails.address) errors.push("Missing customer address");
  if (!customerDetails.pincode || !customerDetails.pincode.match(/^\d{6}$/)) 
    errors.push("Invalid pincode (must be 6 digits)");
  if (!customerDetails.city) errors.push("Missing customer city");
  if (!customerDetails.state) errors.push("Missing customer state");
  
  // Validate dimensions and weight
  if (!order.orderBoxHeight || isNaN(order.orderBoxHeight) || order.orderBoxHeight <= 0)
    errors.push("Invalid box height");
  if (!order.orderBoxWidth || isNaN(order.orderBoxWidth) || order.orderBoxWidth <= 0)
    errors.push("Invalid box width");
  if (!order.orderBoxLength || isNaN(order.orderBoxLength) || order.orderBoxLength <= 0)
    errors.push("Invalid box length");
  if (!order.orderWeight || isNaN(order.orderWeight) || order.orderWeight <= 0)
    errors.push("Invalid order weight");
  
  // Validate payment details
  if (!(order.payment_mode === 0 || order.payment_mode === 1))
    errors.push("Invalid payment mode (must be 0 for Prepaid or 1 for COD)");
  
  if (order.payment_mode === 1 && (!order.amount2Collect || order.amount2Collect <= 0))
    errors.push("COD amount must be greater than 0 for COD orders");
  
  return errors;
}

export async function generateErrorCSV(res: Response, errorRows: any[]): Promise<Response> {
  const errorWorkbook = new exceljs.Workbook();
  const errorWorksheet = errorWorkbook.addWorksheet('Error Sheet');

  errorWorksheet.columns = [
    { header: 'order_reference_id', key: 'order_reference_id', width: 20 },
    { header: 'Error Message', key: 'errors', width: 60 },
  ];

  errorWorksheet.addRows(errorRows);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');

  await errorWorkbook.csv.write(res);
  return res.end();
}

