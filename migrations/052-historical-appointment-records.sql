-- Historical source sheets do not establish prices, payments, staff or durations.
-- Keep those facts unknown without weakening the rules for normal bookings.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS is_historical_only BOOLEAN NOT NULL DEFAULT FALSE,
  ALTER COLUMN service_price DROP NOT NULL,
  ALTER COLUMN reservation_fee DROP NOT NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS historical_import_key TEXT,
  ADD COLUMN IF NOT EXISTS historical_source JSONB,
  ALTER COLUMN booked_service_price DROP NOT NULL,
  ALTER COLUMN booked_reservation_fee DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_historical_import_key
  ON appointments(historical_import_key) WHERE historical_import_key IS NOT NULL;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_payment_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_payment_status_check
  CHECK (payment_status IN ('unpaid','pending','paid','refunded','failed','not_recorded'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='services_historical_prices' AND conrelid='services'::regclass) THEN
    ALTER TABLE services ADD CONSTRAINT services_historical_prices CHECK (
      (is_historical_only AND NOT is_active AND service_price IS NULL AND reservation_fee IS NULL)
      OR (NOT is_historical_only AND service_price IS NOT NULL AND reservation_fee IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appointments_historical_prices' AND conrelid='appointments'::regclass) THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_historical_prices CHECK (
      historical_import_key IS NOT NULL
      OR (booked_service_price IS NOT NULL AND booked_reservation_fee IS NOT NULL AND payment_status <> 'not_recorded')
    );
  END IF;
END $$;
