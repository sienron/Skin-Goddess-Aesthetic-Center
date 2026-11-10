CREATE TABLE IF NOT EXISTS clinic_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO clinic_settings(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS clinic_operating_hours (
  weekday SMALLINT PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  opening_time TIME NOT NULL DEFAULT '09:00',
  closing_time TIME NOT NULL DEFAULT '18:00',
  CHECK (opening_time < closing_time)
);
INSERT INTO clinic_operating_hours(weekday) SELECT generate_series(0,6) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS clinic_schedule_changes (
  change_id BIGSERIAL PRIMARY KEY,
  days JSONB NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clinic_closures (
  closure_id BIGSERIAL PRIMARY KEY,
  closure_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  created_by INTEGER NOT NULL REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reopened_at TIMESTAMPTZ,
  reopened_by INTEGER REFERENCES users(user_id),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS clinic_closures_active_date ON clinic_closures(closure_date) WHERE reopened_at IS NULL;
CREATE TABLE IF NOT EXISTS clinic_appointment_impacts (
  impact_id BIGSERIAL PRIMARY KEY,
  closure_id BIGINT REFERENCES clinic_closures(closure_id),
  change_id BIGINT REFERENCES clinic_schedule_changes(change_id),
  appointment_id INTEGER NOT NULL REFERENCES appointments(appointment_id),
  original_date DATE NOT NULL,
  original_time TIME NOT NULL,
  resolution VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (resolution IN ('pending','rescheduled','cancelled','reopened')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CHECK ((closure_id IS NOT NULL) <> (change_id IS NOT NULL)),
  UNIQUE(closure_id, appointment_id),
  UNIQUE(change_id, appointment_id)
);
CREATE INDEX IF NOT EXISTS clinic_impacts_pending ON clinic_appointment_impacts(appointment_id) WHERE resolution = 'pending';
CREATE TABLE IF NOT EXISTS clinic_notification_deliveries (
  delivery_id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  closure_id BIGINT REFERENCES clinic_closures(closure_id),
  appointment_id INTEGER REFERENCES appointments(appointment_id),
  notification_id BIGINT REFERENCES notifications(notification_id),
  idempotency_key UUID NOT NULL DEFAULT gen_random_uuid(),
  email_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending','sending','sent','failed','not_requested')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  attempted_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  UNIQUE(event_key, user_id)
);
ALTER TABLE clinic_notification_deliveries ADD COLUMN IF NOT EXISTS idempotency_key UUID NOT NULL DEFAULT gen_random_uuid();
-- One durable event creates one bell/history notification and one email delivery.
CREATE OR REPLACE FUNCTION clinic_queue_event(p_key TEXT, p_user INTEGER, p_type TEXT, p_message TEXT,
  p_closure BIGINT DEFAULT NULL, p_appointment INTEGER DEFAULT NULL, p_email BOOLEAN DEFAULT TRUE) RETURNS VOID AS $$
DECLARE delivery BIGINT; notice BIGINT;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  INSERT INTO clinic_notification_deliveries(event_key,user_id,closure_id,appointment_id,email_status)
  VALUES(p_key,p_user,p_closure,p_appointment,CASE WHEN p_email THEN 'pending' ELSE 'not_requested' END)
  ON CONFLICT DO NOTHING RETURNING delivery_id INTO delivery;
  IF delivery IS NULL THEN RETURN; END IF;
  INSERT INTO notifications(user_id,type,message) VALUES(p_user,p_type,p_message) RETURNING notification_id INTO notice;
  UPDATE clinic_notification_deliveries SET notification_id=notice WHERE delivery_id=delivery;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION clinic_validate_appointment() RETURNS TRIGGER AS $$
DECLARE hours clinic_operating_hours; changed BOOLEAN;
BEGIN
  IF NEW.is_demo THEN RETURN NEW; END IF;
  changed := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    changed := (NEW.appointment_date,NEW.appointment_time,NEW.appointment_end_time,NEW.service_id)
      IS DISTINCT FROM (OLD.appointment_date,OLD.appointment_time,OLD.appointment_end_time,OLD.service_id)
      OR (NEW.appointment_status IN ('pending','confirmed') AND OLD.appointment_status NOT IN ('pending','confirmed'));
    IF (NEW.appointment_date,NEW.appointment_time,NEW.appointment_status) IS DISTINCT FROM
      (OLD.appointment_date,OLD.appointment_time,OLD.appointment_status) THEN NEW.updated_at := NOW(); END IF;
    IF NEW.appointment_status IN ('in_progress','completed','no_show')
      AND NEW.appointment_status IS DISTINCT FROM OLD.appointment_status
      AND EXISTS(SELECT 1 FROM clinic_appointment_impacts WHERE appointment_id=NEW.appointment_id AND resolution='pending') THEN
      RAISE EXCEPTION 'Resolve the clinic schedule conflict before starting or completing this appointment.' USING ERRCODE='P0001';
    END IF;
  END IF;
  IF changed AND NEW.appointment_status IN ('pending','confirmed','in_progress') THEN
    -- Same lock as schedule mutations; a concurrent payment cannot book a newly closed date.
    PERFORM pg_advisory_xact_lock_shared(5032026,1);
    SELECT * INTO hours FROM clinic_operating_hours WHERE weekday=EXTRACT(DOW FROM NEW.appointment_date);
    IF NOT COALESCE(hours.is_open,FALSE) OR NEW.appointment_time < hours.opening_time
      OR NEW.appointment_end_time > hours.closing_time
      OR MOD(EXTRACT(EPOCH FROM NEW.appointment_time)::integer,1800) <> 0
      OR (NEW.appointment_time < '13:00'::time AND NEW.appointment_end_time > '12:00'::time)
      OR EXISTS(SELECT 1 FROM clinic_closures WHERE closure_date=NEW.appointment_date AND reopened_at IS NULL) THEN
      RAISE EXCEPTION 'The clinic is closed or this appointment falls outside its operating hours.' USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clinic_validate_appointment ON appointments;
CREATE TRIGGER clinic_validate_appointment BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION clinic_validate_appointment();

CREATE OR REPLACE FUNCTION clinic_resolve_appointment() RETURNS TRIGGER AS $$
DECLARE impact RECORD; recipient RECORD; outcome TEXT; description TEXT;
BEGIN
  IF NEW.appointment_status='cancelled' THEN outcome := 'cancelled';
  ELSIF (NEW.appointment_date,NEW.appointment_time) IS DISTINCT FROM (OLD.appointment_date,OLD.appointment_time) THEN outcome := 'rescheduled';
  ELSE RETURN NEW; END IF;
  FOR impact IN UPDATE clinic_appointment_impacts SET resolution=outcome,resolved_at=NOW()
    WHERE appointment_id=NEW.appointment_id AND resolution='pending' RETURNING * LOOP
    description := format('Appointment %s was %s%s (Asia/Manila).',NEW.appointment_id,outcome,
      CASE WHEN outcome='rescheduled' THEN format(' to %s at %s',NEW.appointment_date,to_char(NEW.appointment_time,'HH12:MI AM')) ELSE '' END);
    FOR recipient IN SELECT user_id FROM users WHERE status='active'
      AND (role IN ('admin','staff') OR user_id IN (NEW.user_id,NEW.aesthetician_id)) LOOP
      PERFORM clinic_queue_event('resolution:'||NEW.appointment_id||':'||NEW.updated_at,recipient.user_id,
        'appointment_'||outcome,description,impact.closure_id,NEW.appointment_id);
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clinic_resolve_appointment ON appointments;
CREATE TRIGGER clinic_resolve_appointment AFTER UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION clinic_resolve_appointment();
