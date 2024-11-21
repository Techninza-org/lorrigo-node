const PAYMENT_INITIATED = 'Failed';
const PAYMENT_SUCCESSFUL = 'Completed';
const PAYMENT_SUCCESSFUL_PHONEPE = 'PAYMENT_SUCCESS';
const PAYMENT_FAILED = 'Failed';
const PAYMENT_PENDING = 'In Progress';
const PAYMENT_CANCELLED = 'Cancelled';
const PAYMENT_REFUNDED = 'Refunded';

export const rechargeWalletInfo = {
    PAYMENT_INITIATED,
    PAYMENT_SUCCESSFUL,
    PAYMENT_FAILED,
    PAYMENT_PENDING,
    PAYMENT_CANCELLED,
    PAYMENT_REFUNDED,
    PAYMENT_SUCCESSFUL_PHONEPE
}


const NOT_PAID = 'NOT_PAID' 
const PAID = 'PAID'

export const paymentStatusInfo  = { 
    NOT_PAID,
    PAID,    
}