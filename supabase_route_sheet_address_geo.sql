-- Кэш геокодинга и км по дорогам (офис → точка) для маршрутного листа. Выполнить в Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS route_sheet_address_geo (
  address_key text PRIMARY KEY,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  km_office double precision,
  updated_at timestamptz NOT NULL DEFAULT now()
)

COMMENT ON TABLE route_sheet_address_geo IS 'Нормализованный ключ полной строки адреса → координаты и км от офиса; повторные запросы без Nominatim/OSRM.';
COMMENT ON COLUMN route_sheet_address_geo.address_key IS 'trim(lower(полная_строка_адреса)) — см. addressForNominatimSearch в route-sheet.js';
COMMENT ON COLUMN route_sheet_address_geo.km_office IS 'Дистанция по дорогам от офиса, км; NULL если координаты есть, а OSRM не вернул дистанцию';

CREATE INDEX IF NOT EXISTS idx_route_sheet_address_geo_updated ON route_sheet_address_geo (updated_at DESC);

ALTER TABLE route_sheet_address_geo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "route_sheet_address_geo authenticated all"
  ON route_sheet_address_geo
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
