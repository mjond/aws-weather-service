import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CACHE_TABLE_NAME = process.env.CACHE_TABLE_NAME!;
const CACHE_TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || "3600", 10);

/** Default when `forecastDays` is omitted or invalid (matches GraphQL input default). */
export const DEFAULT_FORECAST_DAYS = 7;
/** Open-Meteo air-quality `forecast_days` maximum. */
export const MAX_FORECAST_DAYS = 7;

export interface DailyAirQualityForecastData {
  date: string;
  pm25High?: number;
  pm25Low?: number;
  pm10High?: number;
  pm10Low?: number;
  usAqiHigh?: number;
  usAqiLow?: number;
}

export interface AirQualityData {
  latitude: number;
  longitude: number;
  current?: {
    time: string;
    usAqi?: number;
    pm10?: number;
    pm25?: number;
  };
  forecast?: DailyAirQualityForecastData[];
}

/**
 * Normalizes client `forecastDays` for Open-Meteo and cache keys.
 * Non-finite values fall back to DEFAULT_FORECAST_DAYS; clamped to 0..MAX_FORECAST_DAYS.
 */
export function resolveForecastDays(raw: unknown): number {
  if (raw == null) return DEFAULT_FORECAST_DAYS;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_FORECAST_DAYS;
  return Math.max(0, Math.min(MAX_FORECAST_DAYS, Math.floor(n)));
}

export function createCacheKey(
  latitude: number,
  longitude: number,
  forecastDays: number = DEFAULT_FORECAST_DAYS
): string {
  const lat = Math.round(latitude * 100) / 100;
  const lon = Math.round(longitude * 100) / 100;
  const days = resolveForecastDays(forecastDays);
  return `${lat},${lon},${days}`;
}

export async function getCachedData(locationKey: string): Promise<AirQualityData | null> {
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
    return null;
  }
}

export async function setCachedData(locationKey: string, data: AirQualityData): Promise<void> {
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
  }
}
