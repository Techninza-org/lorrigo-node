import { z } from "zod";
import { isValidObjectId } from "mongoose";

export const validatePhone = (phone: string): boolean => {
   if (typeof phone !== "string") return false;

   let cleaned = phone.replace(/\D/g, "");

   // Remove country code +91 or 91 if present
   if (cleaned.startsWith("91") && cleaned.length > 10) {
      cleaned = cleaned.slice(2);
   }

   // Validate 10-digit format without leading 0
   return cleaned.length === 10 && /^[1-9]\d{9}$/.test(cleaned);
};

export const formatPhoneNumber = (phone: string | number): string => {
   if (typeof phone !== "string") {
      phone = String(phone);
   }

   phone = phone.replace(/\D/g, "");

   switch (true) {
      case phone.startsWith("91") && phone.length === 12:
         return phone.slice(2);

      // Remove US/Canada country code (+1)
      case phone.startsWith("1") && phone.length === 11:
         return phone.slice(1);

      // Remove US/Canada country code (1) with space or formatting
      case phone.startsWith("+1") && phone.length === 12:
         return phone.slice(2);

      case phone.length === 10:
         return phone;

      case phone.length > 10:
         return phone.slice(-10);

      default:
         return "";
   }
};


// Define Zod Schema
const hubSchema = z.object({
   name: z.string().min(1, "Name is required"),
   contactPersonName: z.string().min(1, "Contact person name is required")
      .refine((value) => !/\d/.test(value), { message: "Contact person name cannot contain numbers" }),
   phone: z.string().refine(validatePhone, { message: "Invalid phone number" }),
   address1: z.string().min(1, "Address is required"),
   // .refine((value) => /[\/#-]/.test(value), { message: "Address must contain /, #, or -" }),
   address2: z.string().optional(),
   pincode: z.string().min(6, "Pincode is required and must be at least 6 characters"),
   isRTOAddressSame: z.boolean().optional(),
   rtoAddress: z.string().optional(),
   rtoCity: z.string().optional(),
   rtoState: z.string().optional(),
   rtoPincode: z.string().optional()
}).refine((data) => {
   if (!data.isRTOAddressSame) {
      return (data.rtoAddress?.length ?? 0) >= 5;
   }
   return true;
}, {
   message: "RTO Address must be at least 5 characters long",
   path: ["rtoAddress"]
}).refine((data) => {
   if (!data.isRTOAddressSame) {
      return (data.rtoPincode?.length ?? 0) === 6;
   }
   return true;
}, {
   message: "RTO Pincode must be 6 characters long",
   path: ["rtoPincode"]
});

// Validate Function
export const hubValidatePayload = (body: any) => {
   try {
      hubSchema.parse(body);
      return { valid: true };
   } catch (error) {
      if (error instanceof z.ZodError) {
         return { valid: false, message: error.errors.map(err => err.message).join(", ") };
      }
      return { valid: false, message: "Invalid payload" };
   }
};
const productDetailsSchema = z.object({
   name: z.string().min(1, "Product name is required").max(150, "Product name should be less than 150 characters"),
   category: z.string().min(1, "Product category is required"),
   hsn_code: z.string().optional(),
   quantity: z.coerce.number().min(1, "Product quantity is required"),
   taxRate: z.coerce.number().min(0, "Tax rate must be a valid number"),
   taxableValue: z.coerce.number().min(1, "Taxable value is required, Please provide the estimated shipment value."),
});

// Seller Details Schema
const sellerDetailsSchema = z.object({
   sellerName: z.string().min(1, "Seller name is required"),
   sellerGSTIN: z.string().optional(),
   isSellerAddressAdded: z.boolean(),
   sellerCity: z.string().optional(),
   sellerState: z.string().optional(),
   sellerPhone: z.string().optional().refine((phone) => !phone || validatePhone(phone), {
      message: "Invalid seller phone number",
   }),
   sellerAddress: z.string().optional(),
   sellerPincode: z.coerce.string().optional(),
});

const customerDetailsSchema = z.object({
   name: z.string()
      .min(1, "Customer name is required"),
      // .regex(/^[A-Za-z\s\-~!@#$%^&*()_+={}[\]|':;?\/><.,*+-]+$/, "Name must contain only English letters and special characters (no numbers)"),
   phone: z.string().refine(validatePhone, { message: "Invalid phone number" }),
   address: z.string().min(1, "Address is required"),
   pincode: z.coerce.string().min(6, "Pincode must be at least 6 characters"),
});
const orderItemSchema = z.object({
   name: z.string().optional(),
   sku: z.string().optional(),
   units: z.string().optional(),
   selling_price: z.string().optional(),
   discount: z.string().optional(),
   tax: z.string().optional(),
   hsn: z.string().optional(),
}).superRefine((data, ctx) => {
   if (Object.keys(data).length === 0) {
      return true;
   }
   
   if ('name' in data && data.name !== undefined) {
      if (data.name.length < 1) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Item name is required and must be a valid name",
            path: ['name']
         });
      }
   }
   
   if ('sku' in data && data.sku !== undefined) {
      if (data.sku.length < 1) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "SKU is required and must be a valid SKU",
            path: ['sku']
         });
      }
   }
   
   if ('units' in data && data.units !== undefined) {
      if (data.units.length < 1) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Units are required and must be valid",
            path: ['units']
         });
      }
   }
   
   if ('selling_price' in data && data.selling_price !== undefined) {
      if (data.selling_price.length < 1) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Selling price is required and must be valid",
            path: ['selling_price']
         });
      }
   }
   
   if ('discount' in data && data.discount !== undefined) {
      if (data.discount.length < 1) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Discount is required and must be valid",
            path: ['discount']
         });
      }
   }
   
   if ('tax' in data && data.tax !== undefined) {
      if (data.tax.length < 1) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Tax is required and must be valid",
            path: ['tax']
         });
      }
   }
   
   if ('hsn' in data && data.hsn !== undefined) {
      if (data.hsn.length < 1) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "HSN is required and must be valid",
            path: ['hsn']
         });
      }
   }
});

const orderValidationSchema = z.object({
   order_reference_id: z.string().min(1, "Order reference id is required"),
   payment_mode: z.coerce.number().int().refine((val) => val === 0 || val === 1, { message: "Invalid payment mode, Please select 0 for Prepaid or 1 for COD" }),
   ewaybill: z.string().optional(),
   orderWeight: z.number().min(0.1, "Order weight is required, Should be greater than 0").refine(val => Number(val) >= 0.1),
   orderWeightUnit: z.literal("kg", { message: "Order weight unit must be in 'kg'" }), // Enforcing kg
   order_invoice_date: z.string().optional(),
   order_invoice_number: z.string().optional(),
   numberOfBoxes: z.number().max(1, "Please Select 1").refine(val => val === 1),
   orderSizeUnit: z.literal("cm", { message: "Order size unit must be in 'cm'" }), // Enforcing cm
   orderBoxHeight: z.number().min(0.1, "Order box height is required").refine(val => Number(val) >= 0.1),
   orderBoxWidth: z.number().min(0.1, "Order box width is required").refine(val => Number(val) >= 0.1),
   orderBoxLength: z.number().min(0.1, "Order box length is required").refine(val => Number(val) >= 0.1),
   amount2Collect: z.coerce.number().optional(),
   customerDetails: customerDetailsSchema,
   productDetails: productDetailsSchema,
   orderItems: z.array(orderItemSchema).optional(),
   pickupAddress: z.string().optional(),
   sellerDetails: sellerDetailsSchema,
   isReverseOrder: z.boolean().optional(),
}).refine((data) => {
   return isValidObjectId(data.pickupAddress);
}, {
   message: "Invalid pickupAddress, Enter Valid Id",
   path: ["pickupAddress"],
}).refine((data) => {
   if (data.payment_mode === 1) {
      return Number(data.amount2Collect ?? 0) > 0 && Number(data.amount2Collect ?? 0) <= Number(data.productDetails.taxableValue);
   }
   return true;
}, {
   message: "Amount to Collect greater than 0 and Amount to collect should be less than taxable value",
   path: ["amount2Collect"],
}).refine((data) => {
   if (data.productDetails.taxableValue >= 50000) {
      return (data.ewaybill ?? "").length === 12;
   }
   return true;
}, {
   message: "Ewaybill is required and must be 12 digits for order value >= 50,000",
   path: ["ewaybill"],
});

// Validate Order Payload Function
export const validateOrderPayload = (body: any) => {
   try {
      orderValidationSchema.parse(body);
      return { valid: true };
   } catch (error) {
      console.log(error, "Validation Error");
      if (error instanceof z.ZodError) {
         return { valid: false, message: error.errors.map((err) => `${err.path}: ${err.message}`).join(", "), errors: error.errors };
      }
      return { valid: false, message: "Invalid payload" };
   }
};

export function validateIndianMobileNumber(phoneNumber: string | null | undefined): {
   isValid: boolean;
   normalizedNumber: string;
   formattedNumber: string;
   errorMessage?: string;
} {
   // Handle undefined or null
   if (phoneNumber === null || phoneNumber === undefined) {
      return {
         isValid: false,
         normalizedNumber: '',
         formattedNumber: '',
         errorMessage: 'Phone number is required'
      };
   }

   // Convert to string and clean up the input
   let cleaned = phoneNumber.toString().trim();

   // Remove all non-numeric characters except plus sign at beginning
   cleaned = cleaned.replace(/(?!^\+)[^0-9]/g, '');

   // Check if the number is now empty after cleaning
   if (!cleaned) {
      return {
         isValid: false,
         normalizedNumber: '',
         formattedNumber: '',
         errorMessage: 'Phone number contains no digits'
      };
   }

   // Extract 10-digit number from different formats
   let extractedNumber: string;

   // Case: Starts with +91 (international format)
   if (cleaned.startsWith('+91')) {
      extractedNumber = cleaned.substring(3);
   }
   // Case: Starts with 91 (without plus)
   else if (cleaned.startsWith('91') && cleaned.length > 10) {
      extractedNumber = cleaned.substring(2);
   }
   // Case: Starts with 0 (national format)
   else if (cleaned.startsWith('0')) {
      extractedNumber = cleaned.substring(1);
   }
   // Case: Just the number
   else {
      extractedNumber = cleaned;
   }

   // Validate 10-digit Indian mobile number
   // Indian mobile numbers are 10 digits and start with 6, 7, 8, or 9
   const isValidIndianMobile = /^[6-9]\d{9}$/.test(extractedNumber);

   if (!isValidIndianMobile) {
      let errorMessage = 'Invalid Indian mobile number';

      if (extractedNumber.length !== 10) {
         errorMessage = `Expected 10 digits but got ${extractedNumber.length}`;
      } else if (!/^[6-9]/.test(extractedNumber)) {
         errorMessage = 'Indian mobile numbers must start with 6, 7, 8, or 9';
      }

      return {
         isValid: false,
         normalizedNumber: extractedNumber,
         formattedNumber: '',
         errorMessage
      };
   }

   // Return the validated and normalized number
   return {
      isValid: true,
      normalizedNumber: extractedNumber,
      formattedNumber: `+91 ${extractedNumber.substring(0, 5)} ${extractedNumber.substring(5)}`
   };
}
