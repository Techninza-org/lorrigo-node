import { Types } from "mongoose";
import B2BCalcModel from "../models/b2b.calc.model";
import { B2BOrderModel } from "../models/order.model";
import PincodeModel from "../models/pincode.model";

export async function calculateB2BPriceCouriers(orderId: string, allowedCourierIds: any[]) {
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

    console.log(toRegionName)

    const Fzone = regionToZoneMappingLowercase[fromRegionName];
    const Tzone = regionToZoneMappingLowercase[toRegionName];

    console.log(Fzone, Tzone)

    if (!Fzone || !Tzone) {
        throw new Error('Zone not found for the given region');
    }

    let query: {
        _id: { $in: (Types.ObjectId | null)[] };
        isActive: boolean;
        isReversedCourier?: boolean;
    } = {
        _id: { $in: allowedCourierIds },
        isActive: true,
        isReversedCourier: false,
    };

    const b2bCouriers = await B2BCalcModel.find(query).populate("vendor_channel_id");

    if (b2bCouriers.length === 0) {
        return [];
    }

    const courierDataPromises = b2bCouriers.map(async (courier) => {
        try {
            const result = await calculateRateAndPrice(courier, Tzone, Fzone, order.total_weight, courier._id.toString(), fromRegionName, toRegionName, order.amount);

            const parterPickupTime = courier.pickupTime;
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
                nickName: courier.vendor_channel_id.nickName,
                name: courier.name,
                expectedPickup,
                rtoCharges: result.finalAmount, 
                minWeight: 0.5,
                type: courier.type,
                carrierID: courier.carrierID,
                order_zone: `${Fzone}-${Tzone}`,
                charge: result.finalAmount,
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

export async function calculateRateAndPrice(calcData: any, zoneFrom: string, zoneTo: string, weight: number, calcId: string, fromRegion: string, toRegion: string, amount: number) {
    try {
        const zoneMatrix = calcData.zoneMatrix;
        const zoneMapping = calcData.zoneMapping;

        // if (!zoneMapping.has(zoneFrom) || !zoneMapping.has(zoneTo)) {
        //     throw new Error('Invalid zones');
        // }

        console.log(zoneFrom, zoneTo)

        const rate = zoneMatrix.get(zoneFrom)?.get(zoneTo);
        if (!rate) {
            throw new Error('Rate not found for the given zones');
        }

        const baseFreightCharge = rate * weight;

        const fuelSurcharge = (calcData.fuelSurcharge / 100) * baseFreightCharge;

        const ODACharge = 0; // As of now not required, 
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

        const otherExpensesTotal = 0; // calcData.otherExpenses.reduce((total, expense) => total + expense.amount, 0);

        const totalCostBeforeGST = baseFreightCharge + fuelSurcharge + calcData.docketCharge + ODACharge + greenTax + baseFreightOne + otherExpensesTotal;
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