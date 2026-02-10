// Lambda handler for AppSync GraphQL API
import {
  AirQualityData,
  createCacheKey,
  getCachedData,
  setCachedData,
} from "../repositories/cache";

interface AirQualityInput {
  latitude: number;
  longitude: number;
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

// Helper function to build API URL with parameters
async function fetchWeatherApi(
  url: string,
  params: { latitude: number; longitude: number; current: string[] }
): Promise<Response> {
  const urlParams = new URLSearchParams({
    latitude: params.latitude.toString(),
    longitude: params.longitude.toString(),
    current: params.current.join(","),
  });
  return fetch(`${url}?${urlParams.toString()}`);
}

export const handler = async (event: AppSyncEvent): Promise<AirQualityData> => {
  // AppSync passes input arguments nested under the input field name
  const { latitude, longitude } = event.arguments.input;

  // Create cache key from location
  const locationKey = createCacheKey(latitude, longitude);

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
    };
    const url = "https://air-quality-api.open-meteo.com/v1/air-quality";

    console.log(`Fetching air quality data for lat: ${latitude}, lon: ${longitude}`);

    const response = await fetchWeatherApi(url, params);

    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OpenMeteoResponse;

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
    };

    // Store in cache for future requests
    await setCachedData(locationKey, result);

    return result;
  } catch (error) {
    console.error("Error fetching air quality data:", error);
    throw new Error(
      `Failed to fetch air quality data: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
};
