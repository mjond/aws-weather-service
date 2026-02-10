// Lambda handler for AppSync GraphQL API
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CACHE_TABLE_NAME = process.env.CACHE_TABLE_NAME!;
const CACHE_TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || "3600", 10);

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

interface AirQualityData {
  latitude: number;
  longitude: number;
  current?: {
    time: string;
    usAqi?: number;
    pm10?: number;
    pm25?: number;
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

// Helper function to create cache key from latitude and longitude
function createCacheKey(latitude: number, longitude: number): string {
  // Round to 2 decimal places for cache key (approximately 1km precision)
  const lat = Math.round(latitude * 100) / 100;
  const lon = Math.round(longitude * 100) / 100;
  return `${lat},${lon}`;
}

// Helper function to get cached data
async function getCachedData(locationKey: string): Promise<AirQualityData | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: CACHE_TABLE_NAME,
        Key: { locationKey },
      })
    );

    if (result.Item && result.Item.data) {
      console.log(`Cache hit for location: ${locationKey}`);
      return result.Item.data as AirQualityData;
    }

    console.log(`Cache miss for location: ${locationKey}`);
    return null;
  } catch (error) {
    console.error("Error reading from cache:", error);
    return null; // On cache error, proceed to fetch from API
  }
}

// Helper function to store data in cache
async function setCachedData(locationKey: string, data: AirQualityData): Promise<void> {
  try {
    const ttl = Math.floor(Date.now() / 1000) + CACHE_TTL_SECONDS;

    await docClient.send(
      new PutCommand({
        TableName: CACHE_TABLE_NAME,
        Item: {
          locationKey,
          data,
          ttl,
        },
      })
    );

    console.log(`Cached data for location: ${locationKey} (expires in ${CACHE_TTL_SECONDS}s)`);
  } catch (error) {
    console.error("Error writing to cache:", error);
    // Don't throw - caching is best effort
  }
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
