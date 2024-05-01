import { Document, Types } from 'mongoose';

export interface Hub {
  _id: Types.ObjectId;
  sellerId: Types.ObjectId; // Assuming sellerId is of type ObjectId
  name: string;
  contactPersonName: string;
  pincode: number;
  city: string;
  state: string;
  address1: string;
  address2?: string | null; // Optional
  phone: number;
  delivery_type_id?: number | null; // Optional
  isSuccess?: boolean | null; // Optional
  code?: number | null; // Optional
  message?: string | null; // Optional
  hub_id?: number | null; // Optional
}

// Define types for packageDetailsSchema
interface PackageDetails {
  boxLength: number;
  boxHeight: number;
  boxWidth: number;
  boxSizeUnit: 'cm' | 'm'; // Assuming boxSizeUnit is either cm or m
  boxWeight: number;
  boxWeightUnit: 'g' | 'kg'; // Assuming boxWeightUnit is either g or kg
  invoiceNumber?: string | null; // Optional
  description?: string | null; // Optional
  quantity: number;
}

// Define types for ewaysSchema
interface Eways {
  amount: number;
  ewayBill: string;
  invoiceNumber: number;
}

interface Customer extends Document {
  sellerId: Types.ObjectId;
  name: string;
  phone: string;
  email: string;
  address: string;
  state?: string | null; // Optional
  city?: string | null; // Optional
  pincode: string;
}

// Define the OrderPayload interface
export interface OrderPayload extends Document {
  client_name: string;
  sellerId: string;
  freightType: number;
  pickupType: number;
  InsuranceType: number;
  pickupAddress?: Hub | null;
  invoiceNumber?: string | null;
  description?: string | null;
  totalOrderValue: number;
  amount2Collect?: number;
  gstDetails: {
    shipperGSTIN: string;
    consigneeGSTIN: string;
  };
  packageDetails: PackageDetails[];
  eways: Eways[];
  customers: Customer[] | null;
}