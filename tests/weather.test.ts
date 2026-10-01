import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/core/http.js';
import { conditionKey, decodePlace, encodePlace, fetchForecast, searchPlaces } from '../src/modules/weather/open-meteo.js';

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('open-meteo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads places and describes where they are', async () => {
    const fetch = mockFetch({
      results: [
        { name: 'Paris', latitude: 48.85341, longitude: 2.3488, country: 'France', admin1: 'Île-de-France' },
        { name: 'Paris', latitude: 33.66094, longitude: -95.55551, country: 'United States', admin1: 'Texas' },
      ],
    });
    const places = await searchPlaces('Paris', 'en');
    expect(places.map((p) => p.detail)).toEqual(['Île-de-France, France', 'Texas, United States']);
    expect(String(fetch.mock.calls[0]![0])).toContain('name=Paris');

    // The second lookup is served from the cache.
    await searchPlaces('paris ', 'en');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns no places when nothing matches', async () => {
    mockFetch({ generationtime_ms: 0.1 });
    expect(await searchPlaces('Nowhere at all', 'en')).toEqual([]);
  });

  it('maps a forecast and asks for imperial units when wanted', async () => {
    const fetch = mockFetch({
      timezone: 'Europe/Berlin',
      current: { temperature_2m: 21.4, apparent_temperature: 20.1, relative_humidity_2m: 55, wind_speed_10m: 12.3, weather_code: 2, is_day: 1 },
      daily: {
        time: ['2026-06-01', '2026-06-02', '2026-06-03'],
        weather_code: [2, 61, 0],
        temperature_2m_max: [24, 18, 26],
        temperature_2m_min: [13, 11, 14],
        precipitation_probability_max: [10, 80, null],
      },
    });
    const forecast = await fetchForecast({ latitude: 52.52, longitude: 13.405 }, 'imperial');
    expect(forecast.current).toMatchObject({ temperature: 21.4, code: 2, isDay: true });
    expect(forecast.days[1]).toEqual({ date: '2026-06-02', code: 61, max: 18, min: 11, rainChance: 80 });
    expect(forecast.days[2]!.rainChance).toBeNull();
    const url = String(fetch.mock.calls[0]![0]);
    expect(url).toContain('temperature_unit=fahrenheit');
    expect(url).toContain('wind_speed_unit=mph');
  });

  it('turns HTTP failures into HttpError', async () => {
    mockFetch({ reason: 'busy' }, 503);
    await expect(fetchForecast({ latitude: 0, longitude: 0 }, 'metric')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('place values', () => {
  it('round-trips through the autocomplete value', () => {
    const value = encodePlace({ name: 'Paris', latitude: 33.66094, longitude: -95.55551, detail: 'Texas, United States' });
    expect(decodePlace(value)).toEqual({ latitude: 33.6609, longitude: -95.5555, label: 'Paris, Texas, United States' });
  });

  it('treats typed text as a search', () => {
    expect(decodePlace('Paris')).toBeNull();
    expect(decodePlace('@95,10,Nowhere')).toBeNull();
  });
});

describe('conditionKey', () => {
  it('knows WMO codes and falls back for others', () => {
    expect(conditionKey(95)).toBe('weather.codes.95');
    expect(conditionKey(42)).toBe('weather.codes.unknown');
  });
});
