import admin from 'firebase-admin';

// Initialize Firebase Admin safely for Serverless Environments
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // Replace escaped literal \n with actual newlines for Vercel
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            }),
        });
    } catch (error) {
        console.error('Firebase initialization error', error.stack);
    }
}

const db = admin.firestore();

export default async function handler(req, res) {
    // Safaricom always sends POST requests to the callback
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const stkCallback = req.body?.Body?.stkCallback;

        if (!stkCallback) {
            return res.status(400).json({ error: 'Invalid payload structure' });
        }

        const merchantRequestID = stkCallback.MerchantRequestID;
        const checkoutRequestID = stkCallback.CheckoutRequestID;
        const resultCode = stkCallback.ResultCode;
        const resultDesc = stkCallback.ResultDesc;

        // ResultCode 0 means the user entered their PIN and paid successfully
        if (resultCode === 0) {
            const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
            
            // Safaricom sends data as an array of objects, we need to extract the values
            const getMetadataValue = (key) => {
                const item = callbackMetadata.find(i => i.Name === key);
                return item ? item.Value : null;
            };

            const amount = getMetadataValue('Amount');
            const receiptNumber = getMetadataValue('MpesaReceiptNumber');
            const phone = getMetadataValue('PhoneNumber');
            const transactionDate = getMetadataValue('TransactionDate'); // Format: YYYYMMDDHHMMSS

            // Write the successful transaction to Firestore
            await db.collection('transactions').doc(receiptNumber).set({
                merchantRequestID,
                checkoutRequestID,
                amount,
                receiptNumber,
                phone: phone.toString(),
                transactionDate,
                status: 'Completed',
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`Payment saved: ${receiptNumber} for KES ${amount}`);
        } else {
            // ResultCode !== 0 means the user cancelled, lacked funds, or timed out.
            // You can optionally log failed attempts to a separate collection.
            console.log(`Payment failed: ${resultDesc}`);
            await db.collection('failed_transactions').doc(checkoutRequestID).set({
                merchantRequestID,
                checkoutRequestID,
                resultCode,
                resultDesc,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // IMPORTANT: Always respond to Safaricom with a success message.
        // If you don't, Safaricom will think the callback failed and retry sending it for 24 hours.
        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Confirmation Received Successfully"
        });

    } catch (error) {
        console.error("Callback processing error:", error);
        // Even on our internal errors, acknowledge Safaricom to prevent retry spam
        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Error processed but acknowledged"
        });
    }
}
