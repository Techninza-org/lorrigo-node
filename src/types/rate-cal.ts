export type PickupDetails = {
    District: string;
    StateName: string;
};

export type DeliveryDetails = {
    District: string;
    StateName: string;
};

export type Body = {
    weight: number;
    paymentType: number;
    collectableAmount: number;
};

export type Vendor = {
    name: string;
    withinCity: IncrementPrice;
    withinZone: IncrementPrice;
    withinMetro: IncrementPrice;
    northEast: IncrementPrice;
    withinRoi: IncrementPrice;
    codCharge?: {
        hard: number;
        percent: number;
    };
    weightSlab: number;
    incrementWeight: number;
    pickupTime: string;
    carrierID: string;
    type: string;
};

export type IncrementPrice = {
    basePrice: number;
    incrementPrice: number;
    isRTOSameAsFW: boolean
    flatRTOCharge: number
};