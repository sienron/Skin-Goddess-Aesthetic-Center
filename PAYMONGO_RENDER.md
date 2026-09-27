# PayMongo on Render

This app uses PayMongo Hosted Checkout v2. Non-production environments use test mode; production requires live credentials. Checkout and webhook handling are server-side. The public key is not needed for Hosted Checkout.

## Configure Test Mode

For local or other non-production environments, set `NODE_ENV` to a value other than `production`, then configure `PAYMONGO_TEST_SECRET_KEY` with an `sk_test_` secret key and `PAYMONGO_TEST_WEBHOOK_SECRET` with the signing secret from the test-mode webhook endpoint. Test checkout requests use the PayMongo test environment and the `te` webhook signature. Live keys are rejected outside production, and test keys are rejected in production.

## Configure Render

1. In the Render service's Environment settings, set `NODE_ENV=production` and `APP_BASE_URL=https://<your-service>.onrender.com` using the actual Render hostname.
2. Add `PAYMONGO_LIVE_SECRET_KEY` with your live secret key and `PAYMONGO_LIVE_WEBHOOK_SECRET` with the signing secret from the live webhook endpoint. You may keep an existing `PAYMONGO_SK` variable for the live secret, but the webhook secret must use `PAYMONGO_LIVE_WEBHOOK_SECRET`.
3. Set `PAYMONGO_PAYMENT_METHODS` to payment methods enabled for your PayMongo account, for example `card,gcash,qrph`.
4. In the PayMongo live-mode Dashboard, add the webhook URL `https://<your-service>.onrender.com/api/appointments/paymongo/webhook` and select **Checkout Session → `checkout_session.payment.paid`**. Copy its signing secret into Render.
5. Deploy the app and run `npm run migrate` against the production database once before accepting bookings.

Do not put live keys in `.env.example`, browser code, or Git. Use Render's Environment settings for the real values. The service must be publicly reachable over HTTPS; no ngrok tunnel is needed.

## Verify The Flow

1. Sign in as a verified client and select an active service, available date, and time.
2. Continue to the summary page and choose **PAY RESERVATION FEE WITH PAYMONGO**. PayMongo should open its hosted checkout page for the reservation fee stored in the database.
3. Complete a real payment. The app should return to the summary page, receive PayMongo's signed webhook, and create the appointment with payment status `paid`.
4. Cancel a checkout as a negative check; it must not create an appointment. A direct `POST /api/appointments` without a verified payment must return HTTP 402.

Live-mode payments charge real money. Start with a transaction you authorize, verify the webhook and appointment, then issue a refund through PayMongo if appropriate.

Render's free web services can spin down when idle, causing cold starts and delayed webhook processing. PayMongo retries failed webhook delivery, but an always-on service is more reliable for accepting real customer payments.