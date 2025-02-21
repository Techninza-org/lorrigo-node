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
      phone = String(phone); // Convert to string if it's a number
   }

   phone = phone.replace(/\D/g, ""); // Remove non-numeric characters

   if (phone.startsWith("91") && phone.length === 12) {
      return phone.slice(2); // Remove country code
   }

   if (phone.length === 10) {
      return phone; // Already valid 10-digit number
   }

   return ""; // Return empty string if invalid
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
      console.log(error, 'v')
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

// Customer Details Schema
const customerDetailsSchema = z.object({
   name: z.string().min(1, "Customer name is required"),
   phone: z.string().refine(validatePhone, { message: "Invalid phone number" }),
   address: z.string().min(1, "Address is required"),
   pincode: z.coerce.string().min(6, "Pincode must be at least 6 characters"),
});

// Order Validation Schema
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
   pickupAddress: z.string().min(1, "Pickup address is required"),
   sellerDetails: sellerDetailsSchema,
   isReverseOrder: z.boolean(),
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
         return { valid: false, message: error.errors.map((err) => `${err.path} ${err.message}`).join(", ") };
      }
      return { valid: false, message: "Invalid payload" };
   }
};