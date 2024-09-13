import { Types } from "mongoose";
import B2BCalcModel from "../models/b2b.calc.model";
import { B2BOrderModel } from "../models/order.model";
import PincodeModel from "../models/pincode.model";
import { CustomB2BPricingModel } from "../models/custom_pricing.model";
import { getShiprocketB2BConfig } from "./helpers";
import envConfig from "./config";
import APIs from "./constants/third_party_apis";

export const registerB2BShiprocketOrder = async (orderDetails: any, sellerName: string) => {
    try {
        const b2bVol = orderDetails?.packageDetails?.reduce((sum: any, box: any) => sum + parseFloat(String(box.orderBoxHeight * box.orderBoxLength * box.orderBoxWidth) || '0'), 0);

        const shiprocketB2BConfig = await getShiprocketB2BConfig()
        const payload = {
            no_of_packages: orderDetails.quantity || 1,
            approx_weight: orderDetails?.orderWeight?.toString() || "0",
            is_insured: orderDetails.isInsured || false,
            is_to_pay: false, ///
            to_pay_amount: orderDetails.toPayAmount || null,
            source_warehouse_name: orderDetails.pickupAddress?.name,
            source_address_line1: orderDetails.pickupAddress?.address1,
            source_address_line2: orderDetails.pickupAddress?.address2 || "",
            source_pincode: orderDetails.pickupAddress?.pincode,
            source_city: orderDetails.pickupAddress?.city,
            source_state: orderDetails.pickupAddress?.state,
            sender_contact_person_name: orderDetails.pickupAddress?.contactPersonName || sellerName,
            sender_contact_person_email: orderDetails.pickupAddress?.contactPersonEmail || "",
            sender_contact_person_contact_no: orderDetails.pickupAddress?.phone,
            destination_warehouse_name: orderDetails.customerDetails?.name,
            destination_address_line1: orderDetails.customerDetails?.address,
            destination_address_line2: "",
            destination_pincode: orderDetails.customerDetails?.pincode,
            destination_city: orderDetails.customerDetails?.city,
            destination_state: orderDetails.customerDetails?.state,
            recipient_contact_person_name: orderDetails.customerDetails?.name,
            recipient_contact_person_email: orderDetails.customerDetails?.email || "",
            recipient_contact_person_contact_no: orderDetails.customerDetails?.phone,
            client_id: shiprocketB2BConfig.clientId,
            packaging_unit_details: orderDetails.packageDetails.map((packageDetail: any) => ({
                units: packageDetail?.qty || 1,
                length: packageDetail?.orderBoxLength || 0,
                width: packageDetail?.orderBoxWidth || 0,
                height: packageDetail?.orderBoxHeight || 0,
                weight: packageDetail?.orderBoxWeight || 0,
                display_in: "cm"
            })),
            recipient_GST: orderDetails.customerDetails?.gst || null,
            volumetric_weight: (b2bVol / 4500).toString() || "0",
            supporting_docs: orderDetails.supportingDocs || [],
            shipment_type: "forward",
            is_cod: orderDetails.isCOD || false,
            cod_amount: orderDetails.codAmount || null,
            mode_name: "surface",  // Can be dynamic based on order
            source: "API",
            client_order_id: orderDetails.order_reference_id
        };

        const response = await fetch(`${envConfig.SHIPROCKET_B2B_API_BASEURL}${APIs.REGISTER_ORDER_B2B_SHIPROCKET}`, {
            method: 'POST',
            headers: {
                'Authorization': shiprocketB2BConfig.token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        return result;
    } catch (error) {
        console.log(error, 'error in registerB2BShiprocketOrder')
    }
}

export const getB2BShiprocketServicableOrder = async (orderDetails: any) => {
    try {
        const {
            from_pincode,
            from_city,
            from_state,
            to_pincode,
            to_city,
            to_state,
            quantity,
            invoice_value,
            packaging_unit_details
        } = orderDetails;

        // Ensure all required fields are present in the request body
        if (!from_pincode || !from_city || !from_state || !to_pincode || !to_city || !to_state || !quantity || !invoice_value || !packaging_unit_details) {
            throw new Error("Missing required fields.")
        }

        // Construct payload for Shiprocket Shipment Charges API
        const payload = {
            from_pincode,
            from_city,
            from_state,
            to_pincode,
            to_city,
            to_state,
            quantity,
            invoice_value,
            calculator_page: "true", // Required by API
            packaging_unit_details
        };
        const shiprocketB2BConfig = await getShiprocketB2BConfig()

        const response = await fetch(`${envConfig.SHIPROCKET_B2B_API_BASEURL}${APIs.CHECK_B2B_SERVICEABILITY}`, {
            method: 'POST',
            headers: {
                'Authorization': shiprocketB2BConfig.token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        const couriers = await B2BCalcModel.find({ isActive: true, carrierID: { $in: Object?.values(result).map((x: any) => x?.id) } }).select('_id carrierID').lean();

        const courierUpdates = couriers.map((courier: any) => {
            const carrierData: any = Object.values(result).find(
                (x: any) => x.id === courier.carrierID
            );
            return {
                updateOne: {
                    filter: { _id: courier._id },
                    update: {
                        transporter_id: carrierData.transporter_id,
                        transporter_name: carrierData.transporter_name,
                    },
                },
            };
        });

        if (courierUpdates.length > 0) {
            await B2BCalcModel.bulkWrite(courierUpdates);
        }

        const courierIds = couriers.map((courier: any) => courier._id);

        return courierIds;
    } catch (error) {
        console.log(error)
    }
}

export async function calculateB2BPriceCouriers(orderId: string, allowedCourierIds: any[], sellerId: string) {
    const order: any = await B2BOrderModel.findById(orderId).populate(['customer', 'pickupAddress']);
    if (!order) {
        throw new Error('Order not found');
    }

    const pickupPincode = Number(order.pickupAddress.pincode);
    const deliveryPincode = Number(order.customer.pincode);

    const pickupPincodeData = await PincodeModel.findOne({ Pincode: pickupPincode }).exec();
    const deliveryPincodeData = await PincodeModel.findOne({ Pincode: deliveryPincode }).exec();

    if (!pickupPincodeData || !deliveryPincodeData) {
        throw new Error('Pincode data not found');
    }

    const fromRegionName = pickupPincodeData.StateName.toLowerCase(); // convert to lowercase
    const toRegionName = deliveryPincodeData.StateName.toLowerCase(); // convert to lowercase

    const Fzone = regionToZoneMappingLowercase[fromRegionName];
    const Tzone = regionToZoneMappingLowercase[toRegionName];

    if (!Fzone || !Tzone) {
        throw new Error('Zone not found for the given region');
    }

    let b2bCouriers: any[] = [];

    const [customB2bCouriers, b2bCalcCouriers] = await Promise.all([
        CustomB2BPricingModel.find({
            B2BVendorId: { $in: allowedCourierIds },
            sellerId
        }).populate({
            path: 'B2BVendorId',
            populate: {
                path: 'vendor_channel_id'
            }
        }),

        B2BCalcModel.find({
            _id: { $in: allowedCourierIds },
            isActive: true,
            isReversedCourier: false,
        }).populate("vendor_channel_id")
    ]);

    const foundCourierIds = new Set(customB2bCouriers.map((c: any) => c?.B2BVendorId._id.toString()));
    const notFoundCouriers = b2bCalcCouriers.filter(courier => !foundCourierIds.has(courier._id.toString()));
    b2bCouriers = customB2bCouriers.concat(notFoundCouriers);

    const courierDataPromises = b2bCouriers.map(async (courier) => {
        try {
            const result = await calculateRateAndPrice(courier, Fzone, Tzone, order.total_weight, courier._id.toString(), fromRegionName, toRegionName, order.amount);

            const parterPickupTime = courier.pickupTime || courier.B2BVendorId.pickupTime;
            const partnerPickupHour = Number(parterPickupTime.split(":")[0]);
            const partnerPickupMinute = Number(parterPickupTime.split(":")[1]);
            const partnerPickupSecond = Number(parterPickupTime.split(":")[2]);
            const pickupTime = new Date(new Date().setHours(partnerPickupHour, partnerPickupMinute, partnerPickupSecond, 0));

            const currentTime = new Date();
            let expectedPickup: string;
            if (pickupTime < currentTime) {
                expectedPickup = "Tomorrow";
            } else {
                expectedPickup = "Today";
            }
            return {
                // @ts-ignore
                nickName: courier?.vendor_channel_id?.nickName || courier?.B2BVendorId?.vendor_channel_id?.nickName,
                name: courier?.name || courier.B2BVendorId.name,
                expectedPickup,
                rtoCharges: result.finalAmount,
                minWeight: 0.5,
                type: courier.type,
                carrierID: courier?._id || courier?.B2BVendorId?._id,
                order_zone: `${Fzone}-${Tzone}`,
                charge: result.finalAmount,
                transportId: courier.transporter_id,
                transporterName: courier.transporter_name,
                ...result
            };
        } catch (error) {
            console.log(error)
            return null;
        }
    });

    const courierData = await Promise.all(courierDataPromises);
    return courierData.filter(data => data !== null);
}

export async function calculateRateAndPrice(calcData: any, zoneFrom: string, zoneTo: string, weight: number, calcId: string, fromRegion: string, toRegion: string, amount: number, otherExpensesTotal?: number, isODAApplicable?: boolean) {
    try {
        const zoneMatrix = calcData.zoneMatrix;
        const zoneMapping = calcData.zoneMapping;

        // if (!zoneMapping.has(zoneFrom) || !zoneMapping.has(zoneTo)) {
        //     throw new Error('Invalid zones');
        // }

        const rate = zoneMatrix.get(zoneFrom)?.get(zoneTo);
        if (!rate) {
            throw new Error('Rate not found for the given zones');
        }

        const baseFreightCharge = rate * weight;

        const fuelSurcharge = (calcData.fuelSurcharge / 100) * baseFreightCharge;

        const ODACharge = isODAApplicable ? (weight * calcData.ODACharge < 800 ? 800 : weight * calcData.ODACharge) : 0; // As of now not required, 
        // const ODACharge = weight * calcData.ODACharge < 800 ? 800 : weight * calcData.ODACharge;

        let greenTax = 0;
        if (fromRegion !== 'delhi' && toRegion === 'delhi') {
            greenTax = calcData.greenTax;
        }

        const foValue = calcData.foValue;
        const foVPercent = calcData.foPercentage;

        let baseFreightOne = (Number(amount) * Number(foVPercent));
        if (baseFreightOne < 100) {
            baseFreightOne = foValue;
        }

        const totalCostBeforeGST = baseFreightCharge + fuelSurcharge + calcData.docketCharge + ODACharge + greenTax + baseFreightOne + (otherExpensesTotal ?? 0);
        const gst = (18 / 100) * totalCostBeforeGST;
        const finalAmount = totalCostBeforeGST + gst;

        return {
            baseFreightCharge,
            fuelSurcharge,
            ODACharge,
            greenTax,
            otherExpensesTotal,
            gst,
            totalCostBeforeGST,
            finalAmount
        };
    } catch (error) {
        throw error;
    }
}


export const regionToZoneMapping = {
    "delhi": "North 1",
    "gurgaon": "North 1",
    "noida": "North 1",
    "faridabad": "North 1",
    "punjab": "North 2",
    "Rajasthan": "North 2",
    "AMRITSAR": "North 2",
    "JALANDHAR": "North 2",
    "LUDHIANA": "North 2",
    "uttarakhand": "North 2",
    "DEHRADUN": "North 2",
    "uttar pradesh": "North 2",
    "GAUTAM BUDDHA NAGAR": "North 2",
    "AGRA": "North 2",
    "LUCKNOW": "North 2",
    "ALLAHABAD": "North 2",
    "VARANASI": "North 2",
    "GHAZIABAD": "North 2",
    "KANPUR NAGAR": "North 2",
    "chandigarh": "North 2",
    "chandighar": "North 2",
    "solan": "North 2",
    "panchkula": "North 2",
    "jaipur": "North 2",
    "haryana": "North 2",
    "JHAJJAR": "North 2",
    "PANIPAT": "North 2",
    "ambala": "North 2",
    "mumbai": "West 1",
    "thane": "West 1",
    "navi mumbai": "West 1",
    "vasai": "West 1",
    "bhiwandi": "West 1",
    "panvel": "West 1",
    "kalyan": "West 1",
    "dombivli": "West 1",
    "goa": "West 2",
    "SOUTH GOA": "West 2",
    "GANDHI NAGAR": "West 2",
    "RAJKOT": "West 2",
    "SURAT": "West 2",
    "VADODARA": "West 2",
    "VALSAD": "West 2",
    "diu & daman": "West 2",
    "mp": "West 2",
    "BHOPAL": "West 2",
    "INDORE": "West 2",
    "chhattisgarh": "West 2",
    "gujarat": "West 2",
    "rest of maharashtra": "West 2",
    "maharashtra": "West 2",
    "PALGHAR": "West 2",
    "AURANGABAD": "West 2",
    "Nagpur": "West 2",

    "chennai": "South 1",
    "bangalore": "South 1",
    "BENGALURU": "South 1",
    "hyderabad": "South 1",
    "karnataka": "South 2",
    "Dakshina Kannada": "South 2",
    "UDUPI": "South 2",
    "Mysuru": "South 2",
    "tamil nadu": "South 2",
    "SALEM": "South 2",
    "TIRUPPUR": "South 2",
    "COIMBATORE": "South 2",
    "kerala": "South 2",
    "KOZHIKODE": "South 2",
    "ERNAKULAM": "South 2",
    "THIRUVANANTHAPURAM": "South 2",
    "andhra pradesh": "South 2",
    "VISAKHAPATNAM": "South 2",

    "krishna": "South 2",
    "telangana": "South 2",
    "HYDERABAD": "South 2",
    "pondicherry": "South 2",
    "bihar": "East",
    "PATNA": "East",
    "jharkhand": "East",
    "orissa": "East",
    "KHORDA": "East",
    "CUTTACK": "East",
    "PONDICHERRY": "East",
    "west bengal": "East",
    "sikkim": "East",
    "assam": "Northeast",
    "KAMRUP METROPOLITAN": "Northeast",
    "MUZAFFARPUR": "Northeast",
    "nagaland": "Northeast",
    "mizoram": "Northeast",
    "manipur": "Northeast",
    "meghalaya": "Northeast",
    "ap": "Northeast",
    "tripura": "Northeast",
    "jammu and kashmir": "Northeast",
    "JAMMU": "Northeast",
};

// Ensure all keys are lowercase for case-insensitive matching
export const regionToZoneMappingLowercase = Object.fromEntries(
    Object.entries(regionToZoneMapping).map(([key, value]) => [key.toLowerCase(), value])
);
// Note: Adjust the mapping keys to match your data structure accurately.
// export const zoneToRegionMapping = Object.fromEntries(
//     Object.entries(regionToZoneMapping).map(([region, zone]) => [zone, region])
// );