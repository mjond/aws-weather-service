// Lambda handler for AppSync GraphQL API
import {
  AirQualityData,
  DailyAirQualityForecastData,
  createCacheKey,
  getCachedData,
  resolveForecastDays,
  setCachedData,
} from "../repositories/cache";

interface AirQualityInput {
  latitude: number;
  longitude: number;
  forecastDays?: number | null;
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  current?: {
    time: string;
    interval: number;
    us_aqi?: number;
    pm10?: number;
    pm2_5?: number;
  };
  hourly?: {
    time: string[];
    pm10?: (number | null)[];
    pm2_5?: (number | null)[];
    us_aqi?: (number | null)[];
  };
}

// AppSync event structure
// When using input types in GraphQL, AppSync nests the arguments under the input field name
interface AppSyncEvent {
  arguments: {
    input: AirQualityInput;
  };
  identity?: any;
  source?: any;
  request?: any;
  prev?: any;
  info?: {
    selectionSetList?: string[];
    selectionSetGraphQL?: string;
    parentTypeName?: string;
    fieldName?: string;
    variables?: Record<string, any>;
  };
}

type DayBuckets = Map<string, { pm10: number[]; pm25: number[]; usAqi: number[] }>;

function isValidNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

function aggregateHourlyToDailyForecast(
  hourly: NonNullable<OpenMeteoResponse["hourly"]>
): DailyAirQualityForecastData[] {
  const { time, pm10 = [], pm2_5 = [], us_aqi = [] } = hourly;
  const buckets: DayBuckets = new Map();

  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    const day = t.length >= 10 ? t.slice(0, 10) : t;
    let b = buckets.get(day);
    if (!b) {
      b = { pm10: [], pm25: [], usAqi: [] };
      buckets.set(day, b);
    }
    const p10 = pm10[i];
    const p25 = pm2_5[i];
    const aqi = us_aqi[i];
    if (isValidNumber(p10)) b.pm10.push(p10);
    if (isValidNumber(p25)) b.pm25.push(p25);
    if (isValidNumber(aqi)) b.usAqi.push(aqi);
  }

  const dates = [...buckets.keys()].sort();
  return dates.map((date) => {
    const b = buckets.get(date)!;
    const row: DailyAirQualityForecastData = { date };
    if (b.pm25.length > 0) {
      row.pm25Low = Math.min(...b.pm25);
      row.pm25High = Math.max(...b.pm25);
    }
    if (b.pm10.length > 0) {
      row.pm10Low = Math.min(...b.pm10);
      row.pm10High = Math.max(...b.pm10);
    }
    if (b.usAqi.length > 0) {
      row.usAqiLow = Math.round(Math.min(...b.usAqi));
      row.usAqiHigh = Math.round(Math.max(...b.usAqi));
    }
    return row;
  });
}

async function fetchWeatherApi(
  url: string,
  params: {
    latitude: number;
    longitude: number;
    current: string[];
    hourly: string[];
    forecast_days: number;
  }
): Promise<Response> {
  const urlParams = new URLSearchParams({
    latitude: params.latitude.toString(),
    longitude: params.longitude.toString(),
    current: params.current.join(","),
    hourly: params.hourly.join(","),
    forecast_days: params.forecast_days.toString(),
  });
  return fetch(`${url}?${urlParams.toString()}`);
}

export const handler = async (event: AppSyncEvent): Promise<AirQualityData> => {
  // AppSync passes input arguments nested under the input field name
  const { latitude, longitude, forecastDays: forecastDaysRaw } = event.arguments.input;
  const forecastDays = resolveForecastDays(forecastDaysRaw);

  const locationKey = createCacheKey(latitude, longitude, forecastDays);

  try {
    // Check cache first
    const cachedData = await getCachedData(locationKey);
    if (cachedData) {
      return cachedData;
    }

    // Cache miss - fetch from API
    const params = {
      latitude,
      longitude,
      current: ["us_aqi", "pm10", "pm2_5"],
      hourly: ["pm10", "pm2_5", "us_aqi"],
      forecast_days: forecastDays,
    };
    const url = "https://air-quality-api.open-meteo.com/v1/air-quality";

    console.log(
      `Fetching air quality data for lat: ${latitude}, lon: ${longitude}, forecastDays: ${forecastDays}`
    );

    const response = await fetchWeatherApi(url, params);

    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OpenMeteoResponse;

    const forecast =
      forecastDays > 0 && data.hourly?.time?.length
        ? aggregateHourlyToDailyForecast(data.hourly)
        : undefined;

    const result: AirQualityData = {
      latitude: data.latitude,
      longitude: data.longitude,
      current: data.current
        ? {
            time: data.current.time,
            usAqi: data.current.us_aqi,
            pm10: data.current.pm10,
            pm25: data.current.pm2_5,
          }
        : undefined,
      forecast,
    };

    // Store in cache for future requests
    await setCachedData(locationKey, result);

    return result;
  } catch (error) {
    console.error("Error fetching air quality data:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to fetch air quality data: ${message}`, { cause: error });
  }
};
