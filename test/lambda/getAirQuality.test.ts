import { handler } from "../../lambda/getAirQuality";
import * as cache from "../../repositories/cache";

jest.mock("../../repositories/cache", () => {
  const actual = jest.requireActual<typeof import("../../repositories/cache")>(
    "../../repositories/cache"
  );
  return {
    ...actual,
    getCachedData: jest.fn(),
    setCachedData: jest.fn(),
    createCacheKey: jest.fn(),
  };
});

const mockGetCachedData = cache.getCachedData as jest.MockedFunction<typeof cache.getCachedData>;
const mockSetCachedData = cache.setCachedData as jest.MockedFunction<typeof cache.setCachedData>;
const mockCreateCacheKey = cache.createCacheKey as jest.MockedFunction<typeof cache.createCacheKey>;

global.fetch = jest.fn();

describe("getAirQuality Lambda Handler", () => {
  // Suppress console output during tests
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  beforeAll(() => {
    console.log = jest.fn();
    console.error = jest.fn();
  });

  afterAll(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateCacheKey.mockReturnValue("40.71,-74.01,7");
  });

  const mockEvent = {
    arguments: {
      input: {
        latitude: 40.7128,
        longitude: -74.006,
      },
    },
  };

  const mockApiResponse = {
    latitude: 40.7128,
    longitude: -74.006,
    current: {
      time: "2024-01-01T12:00:00Z",
      interval: 900,
      us_aqi: 50,
      pm10: 25.5,
      pm2_5: 15.2,
    },
  };

  const baseExpected = {
    latitude: 40.7128,
    longitude: -74.006,
    current: {
      time: "2024-01-01T12:00:00Z",
      usAqi: 50,
      pm10: 25.5,
      pm25: 15.2,
    },
  };

  const expectedResult = { ...baseExpected, forecast: undefined };

  describe("Cache Hit", () => {
    it("should return cached data when available", async () => {
      mockGetCachedData.mockResolvedValue(expectedResult);

      const result = await handler(mockEvent);

      expect(result).toEqual(expectedResult);
      expect(mockGetCachedData).toHaveBeenCalledWith("40.71,-74.01,7");
      expect(mockSetCachedData).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("Cache Miss", () => {
    it("should fetch from API and cache result", async () => {
      mockGetCachedData.mockResolvedValue(null);
      jest.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      const result = await handler(mockEvent);

      expect(result).toEqual(expectedResult);
      expect(mockGetCachedData).toHaveBeenCalledWith("40.71,-74.01,7");
      expect(mockSetCachedData).toHaveBeenCalledWith("40.71,-74.01,7", expectedResult);
      expect(global.fetch).toHaveBeenCalled();
    });

    it("should handle API response without current data", async () => {
      mockGetCachedData.mockResolvedValue(null);
      jest.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          latitude: 40.7128,
          longitude: -74.006,
        }),
      } as Response);

      const result = await handler(mockEvent);

      expect(result).toEqual({
        latitude: 40.7128,
        longitude: -74.006,
        current: undefined,
        forecast: undefined,
      });
      expect(mockSetCachedData).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should throw error when API request fails", async () => {
      mockGetCachedData.mockResolvedValue(null);
      jest.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      await expect(handler(mockEvent)).rejects.toThrow(
        "Failed to fetch air quality data: Open-Meteo API error: 500 Internal Server Error"
      );
    });

    it("should throw error when fetch throws", async () => {
      mockGetCachedData.mockResolvedValue(null);
      jest.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

      await expect(handler(mockEvent)).rejects.toThrow(
        "Failed to fetch air quality data: Network error"
      );
    });

    it("should throw error when JSON parsing fails", async () => {
      mockGetCachedData.mockResolvedValue(null);
      jest.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as unknown as Response);

      await expect(handler(mockEvent)).rejects.toThrow(
        "Failed to fetch air quality data: Invalid JSON"
      );
    });
  });

  describe("Cache Key Creation", () => {
    it("should create cache key from coordinates", async () => {
      mockGetCachedData.mockResolvedValue(null);
      jest.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      await handler(mockEvent);

      expect(mockCreateCacheKey).toHaveBeenCalledWith(40.7128, -74.006, 7);
    });

    it("should pass forecastDays through cache key and Open-Meteo request", async () => {
      mockCreateCacheKey.mockReturnValue("40.71,-74.01,3");
      mockGetCachedData.mockResolvedValue(null);
      jest.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      await handler({
        arguments: {
          input: {
            latitude: 40.7128,
            longitude: -74.006,
            forecastDays: 3,
          },
        },
      });

      expect(mockCreateCacheKey).toHaveBeenCalledWith(40.7128, -74.006, 3);
      expect(mockGetCachedData).toHaveBeenCalledWith("40.71,-74.01,3");
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("forecast_days=3"));
    });
  });

  describe("Daily forecast from hourly", () => {
    it("should aggregate hourly values into per-day high and low", async () => {
      mockGetCachedData.mockResolvedValue(null);
      jest.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ...mockApiResponse,
          hourly: {
            time: ["2024-01-01T08:00", "2024-01-01T12:00", "2024-01-02T10:00"],
            pm10: [10, 20, 15],
            pm2_5: [5, 15, 10],
            us_aqi: [40, 80, 60],
          },
        }),
      } as Response);

      const result = await handler(mockEvent);

      expect(result.forecast).toEqual([
        {
          date: "2024-01-01",
          pm25Low: 5,
          pm25High: 15,
          pm10Low: 10,
          pm10High: 20,
          usAqiLow: 40,
          usAqiHigh: 80,
        },
        {
          date: "2024-01-02",
          pm25Low: 10,
          pm25High: 10,
          pm10Low: 15,
          pm10High: 15,
          usAqiLow: 60,
          usAqiHigh: 60,
        },
      ]);
      expect(mockSetCachedData).toHaveBeenCalledWith(
        "40.71,-74.01,7",
        expect.objectContaining({
          forecast: result.forecast,
        })
      );
    });

    it("should skip null hourly samples when computing min and max", async () => {
      mockGetCachedData.mockResolvedValue(null);
      jest.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ...mockApiResponse,
          hourly: {
            time: ["2024-01-01T08:00", "2024-01-01T09:00", "2024-01-01T10:00"],
            pm2_5: [null, 8, 12] as (number | null)[],
            pm10: [1, null, 3],
            us_aqi: [null, 50, 70],
          },
        }),
      } as Response);

      const result = await handler(mockEvent);

      expect(result.forecast).toEqual([
        {
          date: "2024-01-01",
          pm25Low: 8,
          pm25High: 12,
          pm10Low: 1,
          pm10High: 3,
          usAqiLow: 50,
          usAqiHigh: 70,
        },
      ]);
    });
  });
});
