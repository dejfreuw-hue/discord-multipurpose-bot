import { fetchJson } from '../../core/http.js';

export interface Place {
  name: string;
  latitude: number;
  longitude: number;
  /** "Region, Country" for telling places with the same name apart. */
  detail: string;
}

export type Units = 'metric' | 'imperial';

export interface Forecast {
  timezone: string;
  current: { temperature: number; feelsLike: number; humidity: number; wind: number; code: number; isDay: boolean };
  days: { date: string; code: number; max: number; min: number; rainChance: number | null }[];
}

interface GeocodingResponse {
  results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[];
}

interface ForecastResponse {
  timezone: string;
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
    is_day: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max?: (number | null)[];
  };
}

const geocodeCache = new Map<string, { at: number; places: Place[] }>();
const CACHE_MS = 3_600_000;

/** Looks up places by name. Results are cached for an hour because autocomplete asks on every keystroke. */
export async function searchPlaces(query: string, language: string, timeoutMs = 2500): Promise<Place[]> {
  const key = `${language}:${query.trim().toLowerCase()}`;
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.places;

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: query.trim(), count: '10', language, format: 'json' }).toString();
  const data = await fetchJson<GeocodingResponse>(url.toString(), { timeoutMs });
  const places = (data.results ?? []).map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    detail: [r.admin1, r.country].filter((p) => p && p !== r.name).join(', '),
  }));
  if (geocodeCache.size > 1000) geocodeCache.clear();
  geocodeCache.set(key, { at: Date.now(), places });
  return places;
}

export async function fetchForecast(place: Pick<Place, 'latitude' | 'longitude'>, units: Units): Promise<Forecast> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  const params = new URLSearchParams({
    latitude: place.latitude.toFixed(4),
    longitude: place.longitude.toFixed(4),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '3',
  });
  if (units === 'imperial') {
    params.set('temperature_unit', 'fahrenheit');
    params.set('wind_speed_unit', 'mph');
  }
  url.search = params.toString();
  const data = await fetchJson<ForecastResponse>(url.toString());
  const { current, daily } = data;
  return {
    timezone: data.timezone,
    current: {
      temperature: current.temperature_2m,
      feelsLike: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      wind: current.wind_speed_10m,
      code: current.weather_code,
      isDay: current.is_day === 1,
    },
    days: daily.time.map((date, i) => ({
      date,
      code: daily.weather_code[i] ?? 0,
      max: daily.temperature_2m_max[i] ?? 0,
      min: daily.temperature_2m_min[i] ?? 0,
      rainChance: daily.precipitation_probability_max?.[i] ?? null,
    })),
  };
}

const KNOWN_CODES = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);

/** Locale key for a WMO weather code as Open-Meteo reports it. */
export function conditionKey(code: number): string {
  return KNOWN_CODES.has(code) ? `weather.codes.${code}` : 'weather.codes.unknown';
}

/** Autocomplete values carry the coordinates so the command doesn't have to search again. */
export function encodePlace(place: Place): string {
  const label = place.detail ? `${place.name}, ${place.detail}` : place.name;
  return `@${place.latitude.toFixed(4)},${place.longitude.toFixed(4)},${label}`.slice(0, 100);
}

export function decodePlace(value: string): (Pick<Place, 'latitude' | 'longitude'> & { label: string }) | null {
  const match = /^@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?),(.+)$/.exec(value);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, label: match[3]! };
}
