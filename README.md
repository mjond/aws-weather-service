# AWS Weather Service

Showcase serverless API: given a latitude and longitude, return **current** US AQI, PM10, and PM2.5, plus a **daily** forecast summary (high and low per calendar day for those same metrics). Hourly values come from the [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api); the Lambda rolls them up into per-day min/max before returning them over GraphQL.

Forecast length is configurable per request (`forecastDays`, default `7`), capped at what Open-Meteo allows for air quality (currently up to seven days). Results are cached in DynamoDB with a TTL to cut repeat calls for nearby coordinates.

## Tech stack

- **AWS CDK** (TypeScript) — infrastructure
- **AWS AppSync** — GraphQL
- **AWS Lambda** (Node.js 20) — resolver, aggregation, cache read/write
- **Amazon DynamoDB** — cache (TTL)
- **Amazon Cognito Identity Pools** — guest identities for IAM-signed clients
- **AWS WAF** — regional rate limit on AppSync
- **Jest** — tests
- **ESLint + Prettier** — lint / format

## Requirements

- Node.js 18+
- AWS CLI configured and CDK bootstrapped in the account/region you deploy to
- `npm install -g aws-cdk` (or invoke via `npx`)

## Deploy

```bash
npm install
npm run cdk deploy
```

After deploy, note the stack outputs: GraphQL URL, region, Cognito Identity Pool id, and WAF Web ACL ARN. The easiest way to run an ad hoc query is **AWS Console → AppSync → your API → Queries** while signed in with IAM permissions to that API.

## Example query

```graphql
query GetAirQuality($lat: Float!, $lon: Float!, $days: Int) {
  getAirQuality(input: { latitude: $lat, longitude: $lon, forecastDays: $days }) {
    latitude
    longitude
    current {
      time
      usAqi
      pm10
      pm25
    }
    forecast {
      date
      pm25High
      pm25Low
      pm10High
      pm10Low
      usAqiHigh
      usAqiLow
    }
  }
}
```

Example variables (omit `days` to use the schema default of `7`):

```json
{
  "lat": 40.7128,
  "lon": -74.006,
  "days": 3
}
```

## Example response shape

Numbers below are illustrative; real values depend on location and model output.

```json
{
  "data": {
    "getAirQuality": {
      "latitude": 40.71,
      "longitude": -74.01,
      "current": {
        "time": "2026-04-10T15:00",
        "usAqi": 51,
        "pm10": 18.6,
        "pm25": 12.0
      },
      "forecast": [
        {
          "date": "2026-04-10",
          "pm25High": 14.2,
          "pm25Low": 9.1,
          "pm10High": 22.0,
          "pm10Low": 15.3,
          "usAqiHigh": 58,
          "usAqiLow": 42
        },
        {
          "date": "2026-04-11",
          "pm25High": 16.0,
          "pm25Low": 10.5,
          "pm10High": 24.1,
          "pm10Low": 17.0,
          "usAqiHigh": 62,
          "usAqiLow": 45
        }
      ]
    }
  }
}
```

If Open-Meteo returns no usable hourly series for the requested window, `forecast` may be empty or omitted depending on the payload. With `forecastDays: 0`, the resolver does not populate forecast rows.

## Local checks

```bash
npm test
npm run lint
npm run format:check
```

## Cleanup

```bash
npm run cdk destroy
```
