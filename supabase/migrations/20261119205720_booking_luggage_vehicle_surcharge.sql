BEGIN;
ALTER TABLE public.bookings ADD COLUMN luggage_vehicle_surcharge numeric(6,2);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_luggage_vehicle_surcharge_check
  CHECK (luggage_vehicle_surcharge IS NULL OR luggage_vehicle_surcharge IN (0, 5));
COMMENT ON COLUMN public.bookings.luggage_vehicle_surcharge IS
  'Actual extra luggage vehicle surcharge included in price, once per booking. NULL is legacy/unrecorded or an all-inclusive custom total; never infer a retroactive charge.';
COMMIT;
