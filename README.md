# AWS Weather Service

A serverless GraphQL API that provides current air quality data (US AQI, PM10, PM2.5) for any location using the [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api).

## Architecture

Built with:
- **AWS AppSync** - Managed GraphQL API
- **AWS Lambda** - Serverless function to fetch and transform data
- **AWS CDK** - Infrastructure as Code (TypeScript)

## Quick Start

### Prerequisites

- Node.js (v18+)
- AWS Account with CLI configured
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

### Setup

```bash
npm install
npm run build
cdk bootstrap
cdk deploy
```

After deployment, save the API URL and API Key from the output.

## Usage

### GraphQL Query

```graphql
query GetAirQuality {
  getAirQuality(input: { latitude: 40.7128, longitude: -74.0060 }) {
    latitude
    longitude
    current {
      time
      usAqi
      pm10
      pm25
    }
  }
}
```

### Example Request

```bash
curl -X POST https://YOUR_API_URL/graphql \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: YOUR_API_KEY' \
  -d '{
    "query": "query { getAirQuality(input: { latitude: 40.7128, longitude: -74.0060 }) { latitude longitude current { time usAqi pm10 pm25 } } }"
  }'
```

### Testing

Use the built-in GraphQL playground in AWS AppSync Console:
1. Go to AWS Console → AppSync
2. Select your API ("air-quality-api")
3. Click "Queries" tab
4. API key is automatically configured

## Project Structure

```
aws-weather-service/
├── bin/aws-weather-service.ts      # CDK app entry point
├── lib/aws-weather-service-stack.ts # Infrastructure definition
├── lambda/getAirQuality.ts         # Lambda handler
├── schema.graphql                  # GraphQL schema
└── package.json
```

## Cleanup

```bash
cdk destroy
```
