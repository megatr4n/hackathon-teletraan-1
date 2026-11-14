export interface CalendarDayPoint {
  obs_date: string;
  doy: number;
  year: number;
  n_harm: number;
  frp_harm_sum: number;
  n_raw: number;
  frp_raw_sum: number;
  z_score?: number;
  historical_median_frp?: number;
  ratio_to_median?: number;
}

export interface CalendarResponse {
  region_id?: string;
  country_iso?: string;
  start_date: string;
  end_date: string;
  total_detections_harm: number;
  total_fre_energy_tj: number;
  worst_season_year: number;
  series: CalendarDayPoint[];
}

export interface HotspotPoint {
  id: number;
  lat: number;
  lon: number;
  obs_time: string;
  frp_raw: number;
  frp_norm: number;
  weight_count: number;
  sensor: string;
  is_night: boolean;
  confidence: string;
}

export interface HotspotsResponse {
  date: string;
  count: number;
  total_frp: number;
  hotspots: HotspotPoint[];
}

export interface CountryItem {
  iso3: string;
  name_en: string;
  name_uk: string;
  bbox: [number, number, number, number];
  center: [number, number];
  zoom: number;
}

export interface PresetRegion {
  id: string;
  name: string;
  name_en: string;
  bbox: [number, number, number, number];
  default_center: [number, number];
  default_zoom: number;
  critical_event: {
    name: string;
    name_en: string;
    date: string;
    date_range: [string, string];
    peak_doy: number;
    bbox?: [number, number, number, number];
  };
}
