import admin from 'firebase-admin';

// Initialize Firebase Admin securely
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
}
const db = admin.firestore();

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const callbackData = req.body.Body.stkCallback;
    const checkoutRequestID = callbackData.CheckoutRequestID;
    const resultCode = callbackData.ResultCode;

    try {
        const transactionRef = db.collection('payments').doc(checkoutRequestID);

        if (resultCode === 0) {
            // Payment Successful
            const metaItems = callbackData.CallbackMetadata.Item;
            const mpesaReceiptNumber = metaItems.find(i => i.Name === 'MpesaReceiptNumber').Value;
            const amountPaid = metaItems.find(i => i.Name === 'Amount').Value;
            const phoneNumber = metaItems.find(i => i.Name === 'PhoneNumber').Value;

            await transactionRef.set({
                status: 'SUCCESS',
                mpesaReceipt: mpesaReceiptNumber,
                amount: amountPaid,
                phone: phoneNumber,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

        } else {
            // Cancelled or Insufficient Funds
            await transactionRef.set({
                status: 'FAILED',
                reason: callbackData.ResultDesc,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

        // Always reply 200 to Safaricom
        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

    } catch (error) {
        console.error("Firestore Error:", error);
        return res.status(500).end();
    }
}
