import { handler } from "../../lambda/getAirQuality";
import * as cache from "../../repositories/cache";

jest.mock("../../repositories/cache");

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
    mockCreateCacheKey.mockReturnValue("40.71,-74.01");
  });

  const mockEvent = {
    arguments: {
      input: {
        latitude: 40.7128,
        longitude: -74.0060,
      },
    },
  };

  const mockApiResponse = {
    latitude: 40.7128,
    longitude: -74.0060,
    current: {
      time: "2024-01-01T12:00:00Z",
      interval: 900,
      us_aqi: 50,
      pm10: 25.5,
      pm2_5: 15.2,
    },
  };

  const expectedResult = {
    latitude: 40.7128,
    longitude: -74.0060,
    current: {
      time: "2024-01-01T12:00:00Z",
      usAqi: 50,
      pm10: 25.5,
      pm25: 15.2,
    },
  };

  describe("Cache Hit", () => {
    it("should return cached data when available", async () => {
      mockGetCachedData.mockResolvedValue(expectedResult);

      const result = await handler(mockEvent);

      expect(result).toEqual(expectedResult);
      expect(mockGetCachedData).toHaveBeenCalledWith("40.71,-74.01");
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
      expect(mockGetCachedData).toHaveBeenCalledWith("40.71,-74.01");
      expect(mockSetCachedData).toHaveBeenCalledWith("40.71,-74.01", expectedResult);
      expect(global.fetch).toHaveBeenCalled();
    });

    it("should handle API response without current data", async () => {
      mockGetCachedData.mockResolvedValue(null);
      jest.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          latitude: 40.7128,
          longitude: -74.0060,
        }),
      } as Response);

      const result = await handler(mockEvent);

      expect(result).toEqual({
        latitude: 40.7128,
        longitude: -74.0060,
        current: undefined,
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

      expect(mockCreateCacheKey).toHaveBeenCalledWith(40.7128, -74.0060);
    });
  });
});

