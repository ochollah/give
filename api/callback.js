import admin from 'firebase-admin';

// Initialize Firebase Admin safely for Serverless Environments
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // Replace escaped literal \n with actual newlines for serverless backends
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
            console.error('Missing stkCallback in payload body');
            return res.status(400).json({ error: 'Invalid payload structure' });
        }

        const merchantRequestID = stkCallback.MerchantRequestID;
        const checkoutRequestID = stkCallback.CheckoutRequestID;
        const resultCode = stkCallback.ResultCode;
        const resultDesc = stkCallback.ResultDesc;

        // ResultCode 0 means the user entered their PIN and paid successfully
        if (resultCode === 0) {
            const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
            
            // Safe helper matching both normal string Value properties and numeric ones
            const getMetadataValue = (key) => {
                const item = callbackMetadata.find(i => i.Name === key);
                if (!item) return null;
                return item.Value !== undefined ? item.Value : item.NumericValue;
            };

            const amount = getMetadataValue('Amount');
            const receiptNumber = getMetadataValue('MpesaReceiptNumber');
            const phone = getMetadataValue('PhoneNumber');
            const transactionDate = getMetadataValue('TransactionDate'); // Format: YYYYMMDDHHMMSS

            if (!receiptNumber) {
                throw new Error(`Missing MpesaReceiptNumber for successful checkout: ${checkoutRequestID}`);
            }

            // Write the successful transaction to Firestore
            const transactionRef = db.collection('transactions').doc(receiptNumber);
            
            await transactionRef.set({
                merchantRequestID,
                checkoutRequestID,
                amount: Number(amount),
                receiptNumber,
                phone: phone ? phone.toString() : '',
                transactionDate: transactionDate ? transactionDate.toString() : '',
                status: 'Completed',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`Payment logged: ${receiptNumber} for KES ${amount}`);

            // ==============================================================
            // OPTIONAL: RECONCILE SUBSCRIPTION / USER PRE-AUTH STATE HERE
            // ==============================================================
            // Querying your pending checkouts/invoices to activate subscriptions
            const pendingQuery = await db.collection('pending_payments')
                .where('checkoutRequestID', '==', checkoutRequestID)
                .limit(1)
                .get();

            if (!pendingQuery.empty) {
                const pendingDoc = pendingQuery.docs[0];
                const paymentMeta = pendingDoc.data();

                // If your architecture tracks active users or predictive engine models:
                if (paymentMeta.userId) {
                    await db.collection('users').doc(paymentMeta.userId).update({
                        subscriptionStatus: 'Active',
                        subscriptionExpiry: admin.firestore.FieldValue.serverTimestamp(), // Customize lifecycle offset
                        lastReceiptNumber: receiptNumber
                    });
                    console.log(`Successfully provisioned subscription access for user: ${paymentMeta.userId}`);
                }
                
                // Clean up or mark the pending reference request as filled
                await pendingDoc.ref.update({ status: 'Fulfilled', receiptNumber });
            }

        } else {
            // ResultCode !== 0 means the user cancelled, lacked funds, or timed out.
            console.log(`Payment rejected/failed: Code ${resultCode} - ${resultDesc}`);
            
            await db.collection('failed_transactions').doc(checkoutRequestID).set({
                merchantRequestID,
                checkoutRequestID,
                resultCode,
                resultDesc,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            // Fallback status updater if you keep records of pending orders
            const pendingQuery = await db.collection('pending_payments')
                .where('checkoutRequestID', '==', checkoutRequestID)
                .limit(1)
                .get();

            if (!pendingQuery.empty) {
                await pendingQuery.docs[0].ref.update({ 
                    status: 'Failed', 
                    failureReason: resultDesc 
                });
            }
        }

        // IMPORTANT: Always respond to Safaricom with a success message.
        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Confirmation Received Successfully"
        });

    } catch (error) {
        console.error("Callback processing error:", error);
        // Even on internal database errors, acknowledge Safaricom to prevent endless 24hr retry loops
        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Error processed but acknowledged"
        });
    }
}
