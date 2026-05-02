// ... (Your imports and initializations remain the same)

app.post('/api/v1/transfer', async (req, res) => {
    try {
        const { receiverMsisdn, transferAmount, paystackReference, role, type } = req.body;
        const isAdmin = role === 'admin';

        // --- STEP 1: VERIFICATION (Skip if Admin) ---
        if (!isAdmin) {
            const paystackRes = await axios.get(
                `https://api.paystack.co/transaction/verify/${paystackReference}`,
                { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
            );
            if (paystackRes.data.data.status !== 'success') {
                return res.status(400).json({ error: "Payment not verified." });
            }
        } else {
            console.log("🛠️ Admin Mode: Skipping Paystack Verification");
        }

        // --- STEP 2: SIM SELECTION ---
        const selectedSim = await simSelector.selectAvailableSim(transferAmount);
        if (!selectedSim) {
            return res.status(429).json({ error: "No SIMs available with sufficient daily limit." });
        }

        // --- STEP 3: EXECUTE TRANSFER ---
        const mtnPayload = { receiverMsisdn, transferAmount, type: type || 'DATA', targetSystem: 'PP' };
        const mtnResponse = await mtnService.callMTNTransferAPI(selectedSim.msisdn, mtnPayload);

        const isSuccess = mtnResponse && mtnResponse.statusCode === '200';
        const targetTable = isAdmin ? 'test_transfers' : 'transfer_transactions';

        // --- STEP 4: LOG TO APPROPRIATE TABLE ---
        if (isAdmin) {
            await supabase.from('test_transfers').insert([{
                receiver_msisdn: receiverMsisdn,
                amount_gb: transferAmount,
                status: isSuccess ? 'success' : 'failed',
                response_message: mtnResponse?.statusMessage || "Success"
            }]);
        } else if (isSuccess) {
            await supabase.from('transfer_transactions').insert([{
                transaction_id: mtnResponse.transactionId,
                sim_id: selectedSim.id,
                msisdn: selectedSim.msisdn,
                receiver_msisdn: receiverMsisdn,
                transfer_amount: transferAmount,
                payment_reference: paystackReference,
                entry_role: 'customer',
                status: 'success'
            }]);
        }

        if (isSuccess) {
            await simSelector.updateUsage(selectedSim.id, transferAmount);
            return res.status(200).json({ status: "Success", transactionId: mtnResponse.transactionId });
        } else {
            return res.status(400).json({ status: "Failed", message: mtnResponse?.statusMessage });
        }

    } catch (err) {
        console.error("Critical System Error:", err.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ... (Rest of your server.js)
